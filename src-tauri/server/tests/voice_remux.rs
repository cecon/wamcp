//! Voice notes recorded as WebM/Opus are remuxed to Ogg/Opus before going to WhatsApp.
mod common;

use common::http::{multipart, send_multipart};
use common::{Fixture, Incoming};
use serde_json::Value;
use wamcp_server::domain::voice::webm_to_ogg;

const UNKNOWN: [u8; 8] = [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
/// CELT 20 ms, one frame (TOC config 31, code 0).
const TOC_20MS: u8 = 31 << 3;

fn element(id: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut out = id.to_vec();
    let length = payload.len();
    if length < 127 {
        out.push(0x80 | length as u8);
    } else {
        out.extend([0x40 | (length >> 8) as u8, length as u8]);
    }
    out.extend_from_slice(payload);
    out
}

/// A MediaRecorder-like WebM: unknown-size segment and cluster, `count` Opus packets of 20 ms.
fn webm(count: usize, packet_size: usize, with_head: bool) -> Vec<u8> {
    let mut entry = element(&[0x86], b"A_OPUS");
    if with_head {
        let mut head = b"OpusHead\x01\x01".to_vec();
        head.extend(312u16.to_le_bytes());
        head.extend(48_000u32.to_le_bytes());
        head.extend([0, 0, 0]);
        entry.extend(element(&[0x63, 0xA2], &head));
    }
    entry.extend(element(&[0xE1], &element(&[0x9F], &[1])));
    let tracks = element(&[0x16, 0x54, 0xAE, 0x6B], &element(&[0xAE], &entry));
    let mut out = element(&[0x1A, 0x45, 0xDF, 0xA3], &element(&[0x42, 0x82], b"webm"));
    out.extend([0x18, 0x53, 0x80, 0x67]);
    out.extend(UNKNOWN);
    out.extend(tracks);
    out.extend([0x1F, 0x43, 0xB6, 0x75]);
    out.extend(UNKNOWN);
    out.extend(element(&[0xE7], &[0]));
    for index in 0..count {
        let mut block = vec![0x81, 0, index as u8, 0x80, TOC_20MS];
        block.extend(vec![index as u8; packet_size - 1]);
        out.extend(element(&[0xA3], &block));
    }
    out
}

fn crc(data: &[u8]) -> u32 {
    let mut crc = 0u32;
    for byte in data {
        crc ^= u32::from(*byte) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04C1_1DB7
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// (flags, granule, packets) per Ogg page, checking each page's CRC.
fn pages(ogg: &[u8]) -> Vec<(u8, u64, Vec<Vec<u8>>)> {
    let (mut out, mut at) = (Vec::new(), 0);
    while at < ogg.len() {
        assert_eq!(&ogg[at..at + 4], b"OggS");
        let segments = ogg[at + 26] as usize;
        let lacing = &ogg[at + 27..at + 27 + segments];
        let body: usize = lacing.iter().map(|l| *l as usize).sum();
        let end = at + 27 + segments + body;
        let mut page = ogg[at..end].to_vec();
        let stored = u32::from_le_bytes(page[22..26].try_into().unwrap());
        page[22..26].copy_from_slice(&[0; 4]);
        assert_eq!(crc(&page), stored, "page CRC");
        let (mut packets, mut current, mut offset) = (Vec::new(), Vec::new(), at + 27 + segments);
        for l in lacing {
            current.extend_from_slice(&ogg[offset..offset + *l as usize]);
            offset += *l as usize;
            if *l < 255 {
                packets.push(std::mem::take(&mut current));
            }
        }
        let granule = u64::from_le_bytes(ogg[at + 6..at + 14].try_into().unwrap());
        out.push((ogg[at + 5], granule, packets));
        at = end;
    }
    out
}

#[test]
fn remuxes_opus_packets_into_ogg_pages() {
    let ogg = webm_to_ogg(&webm(50, 60, true)).expect("opus");
    assert_eq!(ogg.seconds, 1);
    let pages = pages(&ogg.bytes);
    assert_eq!((pages[0].0, pages[0].2[0][..8].to_vec()), (0x02, b"OpusHead".to_vec()));
    assert!(pages[1].2[0].starts_with(b"OpusTags"));
    let audio: Vec<&Vec<u8>> = pages[2..].iter().flat_map(|p| &p.2).collect();
    assert_eq!(audio.len(), 50);
    assert_eq!((audio[3][0], audio[3].len()), (TOC_20MS, 60));
    let last = pages.last().unwrap();
    assert_eq!((last.0, last.1), (0x04, 50 * 960));

    let long = webm_to_ogg(&webm(600, 300, false)).expect("opus without CodecPrivate");
    let pages = self::pages(&long.bytes);
    assert!(pages.len() > 4, "packets spread over several pages");
    assert_eq!(pages[0].2[0][9], 1, "synthesized head keeps the channel count");
    assert_eq!(pages.last().unwrap().1, 600 * 960);
    assert_eq!(long.seconds, 12);
    assert_eq!(webm_to_ogg(b"not a webm"), None);
    let mut vorbis = webm(3, 10, true);
    let at = vorbis.windows(6).position(|w| w == b"A_OPUS").unwrap();
    vorbis[at..at + 6].copy_from_slice(b"A_VORB");
    assert_eq!(webm_to_ogg(&vorbis), None);
}

#[tokio::test]
async fn recorded_voice_notes_reach_whatsapp_as_ogg() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    f.incoming(&session.id, Incoming::default());
    let recording = webm(100, 40, true);
    let files = [(
        "attachments[]",
        "gravacao.webm",
        "audio/webm;codecs=opus",
        recording.as_slice(),
    )];
    let reply = send_multipart(
        &admin,
        "/conversations/1/messages",
        multipart(&[("voice", "true")], &files),
    )
    .await;
    assert_eq!(reply.status, 201, "{}", reply.text);
    let attachment: &Value = &reply.body["attachments"][0];
    assert_eq!(
        (
            attachment["mime_type"].as_str(),
            attachment["file_name"].as_str(),
            attachment["duration"].as_i64()
        ),
        (Some("audio/ogg; codecs=opus"), Some("gravacao.ogg"), Some(2))
    );
    let media = f.wa.requests.lock().last().unwrap().media.clone().unwrap();
    assert!(media.voice && media.bytes.starts_with(b"OggS"));
    assert_eq!(media.seconds, Some(2));
    let broken = [("attachments[]", "x.webm", "audio/webm", b"garbage".as_slice())];
    let kept = send_multipart(
        &admin,
        "/conversations/1/messages",
        multipart(&[("voice", "true")], &broken),
    )
    .await;
    assert_eq!(
        kept.body["attachments"][0]["mime_type"], "audio/webm",
        "unknown data is sent as recorded"
    );
}
