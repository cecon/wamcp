//! Catalog tools of the inbox assistant (`catalog_*`): Portuguese text with prices like `R$ 29,90`
//! and PDV codes. Reads are audited like the other read tools; `catalog_send_item` needs the send
//! scope and replies (photo + caption) as the bot of this session's inbox, so it only reaches
//! conversations of that inbox.
use super::catalog::Tool;
use super::tools::{arg_int, arg_str, failure, message_of, text, Call};
use crate::application::replies::Draft;
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::menu::money::brl;
use crate::domain::menu::{Choice, ItemView, LinkView, OptionView, Quote, QuoteRequest};
use crate::domain::model::{Credential, Upload};
use serde_json::{Map, Value};
use std::fmt::Write;

fn code(code: &Option<String>) -> String {
    code.as_ref().map(|c| format!(" · código {c}")).unwrap_or_default()
}

fn price(cents: i64, original: Option<i64>) -> String {
    match original {
        Some(o) => format!("{} (de {})", brl(cents), brl(o)),
        None => brl(cents),
    }
}

fn required(item: &ItemView) -> bool {
    item.groups.iter().any(|l| l.link.min > 0)
}

fn summary(item: &ItemView) -> String {
    let price = if item.item.kind == "pizza" {
        "preço pelo tamanho".to_string()
    } else {
        price(item.item.price_cents, item.item.original_price_cents)
    };
    let extras = if required(item) {
        " · tem complementos obrigatórios"
    } else {
        ""
    };
    let code = code(
        &item
            .item
            .external_code
            .clone()
            .or_else(|| item.product.external_code.clone()),
    );
    format!("[item {}] {} — {price}{code}{extras}", item.item.id, item.product.name)
}

fn rule(link: &LinkView) -> String {
    let (min, max) = (link.link.min, link.link.max);
    match (min, max) {
        (0, max) => format!("opcional, até {max}"),
        (min, max) if min == max => format!("obrigatório: escolha {min}"),
        (min, max) => format!("obrigatório: de {min} a {max}"),
    }
}

fn option_line(option: &OptionView, sizes: &[&OptionView]) -> String {
    let mut line = format!("  - [opção {}] {}", option.option.id, option.product.name);
    if let Some(fractions) = &option.option.fractions {
        let max = fractions.iter().max().copied().unwrap_or(1);
        let _ = write!(line, " — {} (até {max} sabores)", brl(option.option.price_cents));
    } else if !option.size_prices.is_empty() {
        let prices: Vec<String> = option
            .size_prices
            .iter()
            .map(|p| {
                let size = sizes.iter().find(|s| s.option.id == p.size_option_id);
                let name = size.map_or_else(|| format!("tamanho {}", p.size_option_id), |s| s.product.name.clone());
                format!("{name} {}", brl(p.price_cents))
            })
            .collect();
        let _ = write!(line, " — {}", prices.join(" · "));
    } else {
        let _ = write!(line, " — + {}", brl(option.option.price_cents));
    }
    if option.option.status != "available" {
        line.push_str(" (indisponível)");
    }
    line + &code(&option.option.external_code)
}

fn detail(item: &ItemView) -> String {
    let mut out = summary(item);
    if let Some(description) = &item.product.description {
        let _ = write!(out, "\n{description}");
    }
    let available = if item.available_now { "sim" } else { "não" };
    let _ = write!(out, "\nDisponível agora: {available}");
    let sizes: Vec<&OptionView> = item
        .groups
        .iter()
        .filter(|l| l.group.group.kind == "size")
        .flat_map(|l| l.group.options.iter())
        .collect();
    for link in &item.groups {
        let group = &link.group.group;
        let _ = write!(out, "\n• {} ({}) [grupo {}]", group.name, rule(link), group.id);
        for option in &link.group.options {
            let _ = write!(out, "\n{}", option_line(option, &sizes));
        }
    }
    out
}

fn quote_text(quote: &Quote, quantity: i64) -> String {
    let mut out = format!(
        "Total: {} ({quantity} × {})",
        brl(quote.total_price_cents),
        brl(quote.unit_price_cents)
    );
    for line in &quote.lines {
        let _ = write!(
            out,
            "\n- {}× {} {}{}",
            line.quantity,
            line.name,
            brl(line.unit_price_cents),
            code(&line.external_code)
        );
    }
    if !quote.errors.is_empty() {
        out.push_str("\nO pedido ainda não pode ser fechado:");
        for error in &quote.errors {
            let _ = write!(out, "\n- {error}");
        }
    }
    out
}

impl Call<'_> {
    pub(super) async fn menu(&self, tool: &Tool, token: &Credential, args: &Map<String, Value>) -> Value {
        let mcp = &self.state.mcp;
        let (Some(menu), Some(support)) = (mcp.menu.as_ref(), mcp.helpdesk.as_ref()) else {
            return failure("Operação não concluída.");
        };
        let id = self.session_id;
        let item_id = arg_int(args, "item_id");
        let result: Result<String> = match tool.name {
            "catalog_send_item" => {
                let action = async {
                    let bot = support.bot_for(id)?;
                    let item = menu.item(&bot, item_id)?;
                    if !item.available_now {
                        return fail(format!("‘{}’ não está disponível agora", item.product.name));
                    }
                    let mut caption = format!("*{}*", item.product.name);
                    if let Some(description) = &item.product.description {
                        let _ = write!(caption, "\n{description}");
                    }
                    if item.item.kind != "pizza" {
                        let _ = write!(
                            caption,
                            "\n{}",
                            price(item.item.price_cents, item.item.original_price_cents)
                        );
                    }
                    let upload = match &item.product.image {
                        Some(file) => menu.image_file(file).ok().filter(|(mime, _)| mime != "image/webp").map(
                            |(mime_type, bytes)| Upload {
                                file_name: Some(file.clone()),
                                mime_type,
                                bytes,
                                voice: false,
                            },
                        ),
                        None => None,
                    };
                    let photo = upload.is_some();
                    let draft = Draft {
                        content: Some(caption),
                        upload,
                        ..Draft::default()
                    };
                    let message = support
                        .send_draft(&bot, arg_int(args, "conversation_id"), draft)
                        .await?;
                    if message.status == "failed" {
                        let reason = message.content_attributes["external_error"]
                            .as_str()
                            .unwrap_or("Falha no envio");
                        return fail(format!("Não foi possível enviar: {reason}"));
                    }
                    let with = if photo { "foto e descrição" } else { "descrição" };
                    Ok(format!(
                        "Enviado ({with}) de ‘{}’ na mensagem {}.",
                        item.product.name, message.id
                    ))
                };
                mcp.act(id, token, tool.name, action).await
            }
            name => mcp.read(id, token, name, || {
                let bot = support.bot_for(id)?;
                match name {
                    "catalog_search" => {
                        let found = menu.search(&bot, arg_str(args, "query").unwrap_or_default(), true)?;
                        if found.is_empty() {
                            return Ok("Nenhum item disponível agora encontrado no cardápio.".into());
                        }
                        let lines: Vec<String> = found.iter().map(summary).collect();
                        Ok(format!("Itens disponíveis ({}):\n{}", found.len(), lines.join("\n")))
                    }
                    "catalog_item" => Ok(detail(&menu.item(&bot, item_id)?)),
                    _ => {
                        let choices: Vec<Choice> =
                            serde_json::from_value(args.get("choices").cloned().unwrap_or_default()).map_err(|_| {
                                HelpdeskError::new("Escolhas inválidas: use [{ option_id, quantity, choices }]")
                            })?;
                        let request = QuoteRequest {
                            item_id,
                            quantity: args.get("quantity").and_then(Value::as_i64).unwrap_or(1),
                            notes: arg_str(args, "notes").map(String::from),
                            choices,
                        };
                        Ok(quote_text(&menu.quote(&bot, &request)?, request.quantity))
                    }
                }
            }),
        };
        match result {
            Ok(message) => serde_json::json!({ "content": [text(&message)] }),
            Err(error) => failure(&message_of(&error, "Operação não concluída.")),
        }
    }
}
