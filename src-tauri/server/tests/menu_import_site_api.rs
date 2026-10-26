//! The store page's own API (`/site-api/v1/merchants/restaurant/{id}/catalog`): items come without
//! complements, which arrive in each item's detail response and are merged by id.
use serde_json::Value;
use wamcp_server::domain::menu::import::{convert, counts};

fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/ifood/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture")).expect("json")
}

#[test]
fn store_catalog_gets_the_complements_of_its_item_details() {
    let catalog = fixture("padaria_site_api.json");
    let detail = fixture("padaria_site_api_item.json");
    for payloads in [vec![catalog.clone(), detail.clone()], vec![detail, catalog]] {
        let tree = convert(&payloads).expect("menu found");
        assert_eq!(tree.categories.len(), 1, "the detail is not a category of its own");
        let items = &tree.categories[0].items;
        assert_eq!(items.len(), 3);
        let beirute = &items[0];
        assert_eq!(
            (
                beirute.price_cents,
                beirute.external_code.as_deref(),
                beirute.ifood_id.as_deref()
            ),
            (5100, Some("8001"), Some("it-beirute"))
        );
        assert_eq!(
            beirute.image_url.as_deref(),
            Some("https://static-images.ifood.com.br/image/upload/t_high/pratos/loja-1/201902091309__beirute.jpg")
        );
        let juice = &beirute.groups[0];
        assert_eq!(
            (juice.name.as_str(), juice.min, juice.max),
            ("Escolha o sabor do suco", 1, 1)
        );
        let options: Vec<(&str, i64, Option<&str>)> = juice
            .options
            .iter()
            .map(|o| (o.name.as_str(), o.price_cents, o.external_code.as_deref()))
            .collect();
        assert_eq!(
            options,
            [("Laranja", 0, None), ("Açaí", 690, None)],
            "ids are not PDV codes"
        );
        let misto = &items[1];
        assert_eq!((misto.price_cents, misto.original_price_cents), (1490, Some(1850)));
        assert!(misto.groups.is_empty());
        assert_eq!(
            (items[2].status.as_str(), items[2].external_code.as_deref()),
            ("unavailable", None)
        );
        let c = counts(&tree);
        assert_eq!((c.items, c.groups, c.options, c.images), (3, 1, 2, 1));
    }
}
