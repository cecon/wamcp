//! Small mappings for WhatsApp connection events: QR images and delivery receipts.
use base64::{engine::general_purpose::STANDARD, Engine};
use qrcode::render::svg;
use qrcode::QrCode;

/// The QR code as an SVG data URL the desktop app shows in an `<img>`.
pub fn qr_data_url(code: &str) -> Option<String> {
    let qr = QrCode::new(code.as_bytes()).ok()?;
    let image = qr.render::<svg::Color>().min_dimensions(280, 280).quiet_zone(true).build();
    Some(format!("data:image/svg+xml;base64,{}", STANDARD.encode(image)))
}

/// Helpdesk delivery state for a receipt about a message we sent (`None` for other receipts).
#[cfg(feature = "whatsapp")]
pub fn receipt_status(kind: &whatsapp_rust::wacore::types::presence::ReceiptType) -> Option<&'static str> {
    use whatsapp_rust::wacore::types::presence::ReceiptType;
    match kind {
        ReceiptType::Delivered => Some("delivered"),
        ReceiptType::Read | ReceiptType::Played => Some("read"),
        ReceiptType::ServerError => Some("failed"),
        _ => None,
    }
}
