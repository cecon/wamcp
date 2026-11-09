//! A simulated finance system for the engine's MVP: fictitious customers, no real money, no network.
//! "Indisponível" makes the tool fail, to exercise the unavailable-tool path.
use crate::application::ports::BusinessTools;
use crate::domain::engine::tools::{from_plugin, text_arg, ToolDef};
use crate::domain::error::{fail, Result};
use crate::domain::plugins::parse;
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct FinanceMock;

pub const CHECK_PAYMENT: &str = "consultar_pagamento";
pub const REGISTER_CHARGE: &str = "registrar_cobranca";

/// The plugin that ships with the app and serves these tools (`financeiro.<tool>`).
pub fn manifest() -> Value {
    json!({
        "id": "financeiro", "name": "Financeiro (simulado)", "version": "1.0.0",
        "description": "Sistema financeiro fictício para testar o motor: sem dinheiro real, sem rede.",
        "tools": [
            { "name": CHECK_PAYMENT,
              "description": "Consulta se um cliente pagou: status, valor e data do pagamento (dados fictícios).",
              "input_schema": { "type": "object", "properties": { "cliente": { "type": "string" } },
                                "required": ["cliente"] },
              "endpoint": { "kind": "builtin" } },
            { "name": REGISTER_CHARGE, "description": "Registra uma cobrança para um cliente (simulada).",
              "side_effects": true, "sensitive": true,
              "input_schema": { "type": "object", "properties": { "cliente": { "type": "string" },
                                "valor": { "type": "number" } }, "required": ["cliente", "valor"] },
              "endpoint": { "kind": "builtin" } }
        ]
    })
}

/// (customer, status, amount in BRL, payment date)
const PAYMENTS: [(&str, &str, f64, Option<&str>); 3] = [
    ("acme", "pago", 1250.0, Some("2026-10-20")),
    ("beta ltda", "pendente", 830.5, None),
    ("gama comércio", "atrasado", 410.0, None),
];

#[async_trait]
impl BusinessTools for FinanceMock {
    /// Alone (without the plugin router, as in the engine's tests) it offers its own tools.
    fn tools(&self, _account_id: i64) -> Vec<ToolDef> {
        let Ok(m) = parse(&manifest(), true) else {
            return Vec::new();
        };
        m.tools.iter().map(|tool| from_plugin(&m, tool)).collect()
    }

    async fn call(&self, _account_id: i64, tool: &str, args: &Value) -> Result<Value> {
        let customer = text_arg(args, "cliente").unwrap_or_default();
        if customer.eq_ignore_ascii_case("indisponível") || customer.eq_ignore_ascii_case("indisponivel") {
            return fail("Sistema financeiro fora do ar (simulado)");
        }
        // Called with the full name (`financeiro.<tool>`) or, from the plugin router, the bare one.
        match tool.strip_prefix("financeiro.").unwrap_or(tool) {
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
