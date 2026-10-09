use super::db::{int, iso, now_ms, opt_text, text, Shape, SqliteStore};
use crate::application::ports::CustomDataRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AttributeDefinition, AttributeFields, Contact, Conversation, CustomFilter, FilterQuery};
use rusqlite::types::Value as Sql;
use serde_json::Value;

const FILTER: Shape = Shape {
    json: &["query"],
    bools: &[],
};
const DEFINITION: Shape = Shape {
    json: &["attribute_values"],
    bools: &[],
};

fn json_text(value: &impl serde::Serialize) -> Result<Sql> {
    Ok(text(serde_json::to_string(value)?))
}

impl CustomDataRepo for SqliteStore {
    fn custom_filters(&self, user_id: i64, filter_type: Option<&str>) -> Result<Vec<CustomFilter>> {
        let sql = "SELECT * FROM custom_filters WHERE user_id=? AND (? IS NULL OR filter_type=?) ORDER BY name, id";
        let kind = opt_text(filter_type);
        self.rows(sql, vec![int(user_id), kind.clone(), kind], FILTER)
    }

    fn custom_filter(&self, id: i64) -> Result<Option<CustomFilter>> {
        self.row("SELECT * FROM custom_filters WHERE id=?", vec![int(id)], FILTER)
    }

    fn create_custom_filter(&self, user_id: i64, name: &str, filter_type: &str, query: &Value) -> Result<CustomFilter> {
        let id = self.insert(
            "INSERT INTO custom_filters(user_id,name,filter_type,query,created) VALUES(?,?,?,?,?)",
            vec![
                int(user_id),
                text(name),
                text(filter_type),
                json_text(query)?,
                text(iso(now_ms())),
            ],
        )?;
        self.custom_filter(id)?
            .ok_or_else(|| Error::internal("custom filter vanished"))
    }

    fn update_custom_filter(&self, id: i64, name: Option<&str>, query: Option<&Value>) -> Result<CustomFilter> {
        let mut fields = Vec::new();
        if let Some(name) = name {
            fields.push(("name", text(name)));
        }
        if let Some(query) = query {
            fields.push(("query", json_text(query)?));
        }
        self.update_fields("custom_filters", int(id), fields)?;
        self.custom_filter(id)?
            .ok_or_else(|| Error::internal("custom filter vanished"))
    }

    fn delete_custom_filter(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM custom_filters WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn attribute_definitions(&self, model: Option<&str>) -> Result<Vec<AttributeDefinition>> {
        let sql = "SELECT * FROM custom_attribute_definitions WHERE ? IS NULL OR attribute_model=?
                   ORDER BY attribute_model, attribute_display_name";
        let model = opt_text(model);
        self.rows(sql, vec![model.clone(), model], DEFINITION)
    }

    fn attribute_definition(&self, id: i64) -> Result<Option<AttributeDefinition>> {
        let sql = "SELECT * FROM custom_attribute_definitions WHERE id=?";
        self.row(sql, vec![int(id)], DEFINITION)
    }

    fn create_attribute_definition(&self, d: &AttributeDefinition) -> Result<AttributeDefinition> {
        let id = self.insert(
            "INSERT INTO custom_attribute_definitions(attribute_display_name,attribute_key,attribute_model,
               attribute_display_type,attribute_description,attribute_values,regex_pattern,regex_cue,created)
             VALUES(?,?,?,?,?,?,?,?,?)",
            vec![
                text(d.attribute_display_name.as_str()),
                text(d.attribute_key.as_str()),
                text(d.attribute_model.as_str()),
                text(d.attribute_display_type.as_str()),
                opt_text(d.attribute_description.as_deref()),
                json_text(&d.attribute_values)?,
                opt_text(d.regex_pattern.as_deref()),
                opt_text(d.regex_cue.as_deref()),
                text(iso(now_ms())),
            ],
        )?;
        self.attribute_definition(id)?
            .ok_or_else(|| Error::internal("attribute definition vanished"))
    }

    fn update_attribute_definition(&self, id: i64, f: &AttributeFields) -> Result<AttributeDefinition> {
        let mut fields = Vec::new();
        if let Some(name) = &f.display_name {
            fields.push(("attribute_display_name", text(name.as_str())));
        }
        if let Some(values) = &f.values {
            fields.push(("attribute_values", json_text(values)?));
        }
        for (key, value) in [
            ("attribute_description", &f.description),
            ("regex_pattern", &f.regex_pattern),
            ("regex_cue", &f.regex_cue),
        ] {
            if let Some(value) = value {
                fields.push((key, opt_text(value.as_deref())));
            }
        }
        self.update_fields("custom_attribute_definitions", int(id), fields)?;
        self.attribute_definition(id)?
            .ok_or_else(|| Error::internal("attribute definition vanished"))
    }

    fn delete_attribute_definition(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM custom_attribute_definitions WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn set_conversation_attributes(&self, id: i64, attributes: &Value) -> Result<()> {
        let sql = "UPDATE conversations SET custom_attributes=? WHERE id=?";
        self.exec(sql, vec![json_text(attributes)?, int(id)]).map(drop)
    }

    fn set_contact_attributes(&self, id: i64, attributes: &Value) -> Result<()> {
        let sql = "UPDATE contacts SET custom_attributes=? WHERE id=?";
        self.exec(sql, vec![json_text(attributes)?, int(id)]).map(drop)
    }

    fn filter_conversations(&self, query: &FilterQuery) -> Result<Vec<Conversation>> {
        self.filtered_conversations(query)
    }

    fn filter_contacts(&self, query: &FilterQuery) -> Result<Vec<Contact>> {
        self.filtered_contacts(query)
    }
}
