//! A simulated finance system for the engine's MVP: fictitious customers, no real money, no network.
//! "Indisponível" makes the tool fail, to exercise the unavailable-tool path.
use crate::application::ports::BusinessTools;
use crate::domain::engine::tools::{text_arg, CHECK_PAYMENT, REGISTER_CHARGE};
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct FinanceMock;

/// (customer, status, amount in BRL, payment date)
const PAYMENTS: [(&str, &str, f64, Option<&str>); 3] = [
    ("acme", "pago", 1250.0, Some("2026-10-20")),
    ("beta ltda", "pendente", 830.5, None),
    ("gama comércio", "atrasado", 410.0, None),
];

#[async_trait]
impl BusinessTools for FinanceMock {
    async fn call(&self, _account_id: i64, tool: &str, args: &Value) -> Result<Value> {
        let customer = text_arg(args, "cliente").unwrap_or_default();
        if customer.eq_ignore_ascii_case("indisponível") || customer.eq_ignore_ascii_case("indisponivel") {
            return fail("Sistema financeiro fora do ar (simulado)");
        }
        match tool {
            CHECK_PAYMENT => {
                let found = PAYMENTS.iter().find(|(name, ..)| name.eq_ignore_ascii_case(&customer));
                Ok(match found {
                    Some((name, status, amount, date)) => json!({
                        "cliente": name.to_uppercase(), "status": status, "valor": amount, "moeda": "BRL",
                        "data_pagamento": date, "fonte": "financeiro-simulado"}),
                    None => json!({"cliente": customer, "status": "nao_encontrado", "fonte": "financeiro-simulado"}),
                })
            }
            REGISTER_CHARGE => Ok(
                json!({"cliente": customer, "valor": args["valor"], "status": "registrada",
                "fonte": "financeiro-simulado"}),
            ),
            _ => fail(format!("Ferramenta não suportada: {tool}")),
        }
    }
}
