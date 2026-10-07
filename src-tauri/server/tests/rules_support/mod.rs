//! Helpers shared by the pure helpdesk rule tests: business errors, conditions and actions.
#![allow(dead_code)]
use serde_json::Value;
use wamcp_server::domain::error::Error;
use wamcp_server::domain::model::{Action, Condition};

/// The message of a business (helpdesk) error; panics on success or any other error.
pub fn message<T: std::fmt::Debug>(result: Result<T, Error>) -> String {
    match result {
        Err(Error::Helpdesk(e)) => e.message,
        other => panic!("expected a business error, got {other:?}"),
    }
}

pub fn cond(attribute: &str, operator: &str, values: Value, query: &str) -> Condition {
    Condition {
        attribute_key: attribute.into(),
        filter_operator: operator.into(),
        values: serde_json::from_value(values).expect("values"),
        query_operator: query.into(),
    }
}

pub fn action(name: &str, params: Value) -> Action {
    Action {
        action_name: name.into(),
        action_params: serde_json::from_value(params).expect("params"),
    }
}
