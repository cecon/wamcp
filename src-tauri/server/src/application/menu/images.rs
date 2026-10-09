//! Product photos, stored as `catalog/<file>` in the data directory and served to logged-in users.
use super::MenuService;
use crate::domain::actor::Actor;
use crate::domain::error::{HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::images::{check_image, image_kind, image_path};
use crate::domain::menu::Product;

impl MenuService {
    fn product_row(&self, id: i64) -> Result<Product> {
        let rows = self.core.repo.menu_rows()?;
        rows.products
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| HelpdeskError::not_found("Produto não encontrado").into())
    }

    /// Validates (PNG/JPG/WebP by content, ≤ 5 MB) and stores a photo; returns the new file name.
    pub(crate) fn store_image(&self, owner: &str, bytes: &[u8]) -> Result<String> {
        let (_, extension) = check_image(bytes)?;
        let file = format!("{owner}-{}.{extension}", uuid::Uuid::new_v4().simple());
        let path = image_path(&file).ok_or_else(|| HelpdeskError::new("Nome de imagem inválido"))?;
        self.storage.save(&path, bytes)?;
        Ok(file)
    }

    pub fn upload_image(&self, actor: &Actor, product_id: i64, bytes: &[u8]) -> Result<Product> {
        require_admin(actor)?;
        let mut product = self.product_row(product_id)?;
        product.image = Some(self.store_image(&format!("p{product_id}"), bytes)?);
        self.core.repo.save_product(&product)?;
        self.changed(actor, "product", "updated", Some(product_id));
        Ok(product)
    }

    pub fn delete_image(&self, actor: &Actor, product_id: i64) -> Result<Product> {
        require_admin(actor)?;
        let mut product = self.product_row(product_id)?;
        product.image = None;
        self.core.repo.save_product(&product)?;
        self.changed(actor, "product", "updated", Some(product_id));
        Ok(product)
    }

    /// The photo bytes and MIME type of a stored file name.
    pub fn image_file(&self, file: &str) -> Result<(String, Vec<u8>)> {
        let missing = || HelpdeskError::not_found("Imagem não encontrada");
        let path = image_path(file).ok_or_else(missing)?;
        let bytes = self.storage.read(&path)?.ok_or_else(missing)?;
        let mime = image_kind(&bytes).map_or("application/octet-stream", |(mime, _)| mime);
        Ok((mime.to_string(), bytes))
    }
}
