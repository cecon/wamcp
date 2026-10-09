//! Voice notes: WhatsApp plays push-to-talk audio only as Ogg/Opus, while Chromium (and the
//! desktop WebView) records WebM/Opus. This remuxes the Opus packets from WebM into Ogg without
//! re-encoding.

/// An Ogg/Opus voice note and its length in whole seconds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OggVoice {
    pub bytes: Vec<u8>,
    pub seconds: i64,
}

const SEGMENT: u32 = 0x1853_8067;
const CLUSTER: u32 = 0x1F43_B675;
const TRACKS: u32 = 0x1654_AE6B;
const TRACK_ENTRY: u32 = 0xAE;
const BLOCK_GROUP: u32 = 0xA0;
const CODEC_ID: u32 = 0x86;
const CODEC_PRIVATE: u32 = 0x63A2;
const CHANNELS: u32 = 0x9F;
const SIMPLE_BLOCK: u32 = 0xA3;
const BLOCK: u32 = 0xA1;
const AUDIO: u32 = 0xE1;

/// An EBML variable-length integer: (value, length). IDs keep their marker bit.
fn vint(data: &[u8], keep_marker: bool) -> Option<(u64, usize)> {
    let first = *data.first()?;
    let length = first.leading_zeros() as usize + 1;
    if length > 8 || data.len() < length {
        return None;
    }
    let mut value = if keep_marker {
        u64::from(first)
    } else {
        u64::from(first) & ((1u64 << (8 - length)) - 1)
    };
    for byte in &data[1..length] {
        value = (value << 8) | u64::from(*byte);
    }
    Some((value, length))
}

#[derive(Default)]
struct Track {
    opus: bool,
    head: Option<Vec<u8>>,
    channels: u8,
    packets: Vec<Vec<u8>>,
}

/// Walks the elements linearly, descending into containers (which handles the "unknown size"
/// segments and clusters MediaRecorder writes).
fn parse(webm: &[u8]) -> Option<Track> {
    let mut track = Track {
        channels: 1,
        ..Track::default()
    };
    let mut position = 0;
    while position < webm.len() {
        let (id, id_length) = vint(&webm[position..], true)?;
        let (size, size_length) = vint(&webm[position + id_length..], false)?;
        let start = position + id_length + size_length;
        let id = id as u32;
        if matches!(id, SEGMENT | CLUSTER | TRACKS | TRACK_ENTRY | BLOCK_GROUP | AUDIO) {
            position = start;
            continue;
        }
        let end = start.checked_add(usize::try_from(size).ok()?)?.min(webm.len());
        let payload = &webm[start..end];
        match id {
            CODEC_ID => track.opus = payload == b"A_OPUS",
            CODEC_PRIVATE => track.head = Some(payload.to_vec()),
            CHANNELS => track.channels = payload.last().copied().unwrap_or(1),
            SIMPLE_BLOCK | BLOCK => {
                // Track number (vint), 16-bit relative timecode, flags, then one Opus packet.
                let (_, track_length) = vint(payload, false)?;
                let frame = payload.get(track_length + 3..)?;
                if !frame.is_empty() {
                    track.packets.push(frame.to_vec());
                }
            }
            _ => {}
        }
        position = end;
    }
    (track.opus && !track.packets.is_empty()).then_some(track)
}

/// Samples (at 48 kHz) in an Opus packet, from its TOC byte (RFC 6716 §3.1).
fn samples(packet: &[u8]) -> u64 {
    let toc = packet[0];
    let config = toc >> 3;
    let per_frame: u64 = match config {
        0..=11 => [480, 960, 1920, 2880][usize::from(config % 4)],
        12..=15 => [480, 960][usize::from(config % 2)],
        _ => [120, 240, 480, 960][usize::from(config % 4)],
    };
    let frames = match toc & 0x03 {
        0 => 1,
        1 | 2 => 2,
        _ => packet.get(1).map_or(1, |b| u64::from(b & 0x3F)),
    };
    per_frame * frames
}

fn crc32(data: &[u8]) -> u32 {
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

fn page(out: &mut Vec<u8>, packets: &[&[u8]], granule: u64, sequence: u32, flags: u8) {
    let mut lacing = Vec::new();
    for packet in packets {
        lacing.extend(std::iter::repeat_n(255u8, packet.len() / 255));
        lacing.push((packet.len() % 255) as u8);
    }
    let mut bytes = b"OggS\0".to_vec();
    bytes.push(flags);
    bytes.extend(granule.to_le_bytes());
    bytes.extend(0x5741_4D43u32.to_le_bytes()); // stream serial "WAMC"
    bytes.extend(sequence.to_le_bytes());
    bytes.extend([0u8; 4]);
    bytes.push(lacing.len() as u8);
    bytes.extend(lacing);
    for packet in packets {
        bytes.extend_from_slice(packet);
    }
    let checksum = crc32(&bytes);
    bytes[22..26].copy_from_slice(&checksum.to_le_bytes());
    out.extend(bytes);
}

fn lacing_segments(packet: &[u8]) -> usize {
    packet.len() / 255 + 1
}

/// Remuxes a WebM/Opus recording into Ogg/Opus; `None` when the input is not WebM with Opus.
pub fn webm_to_ogg(webm: &[u8]) -> Option<OggVoice> {
    let track = parse(webm)?;
    let head = match track.head.filter(|h| h.starts_with(b"OpusHead")) {
        Some(head) => head,
        None => {
            let mut head = b"OpusHead\x01".to_vec();
            head.push(track.channels.max(1));
            head.extend(312u16.to_le_bytes());
            head.extend(48_000u32.to_le_bytes());
            head.extend([0, 0, 0]);
            head
        }
    };
    let pre_skip = u64::from(u16::from_le_bytes([head[10], head[11]]));
    let vendor = b"wamcp";
    let mut tags = b"OpusTags".to_vec();
    tags.extend((vendor.len() as u32).to_le_bytes());
    tags.extend(vendor);
    tags.extend(0u32.to_le_bytes());
    let mut out = Vec::new();
    page(&mut out, &[&head], 0, 0, 0x02);
    page(&mut out, &[&tags], 0, 1, 0x00);
    let (mut granule, mut sequence) = (0u64, 2u32);
    let mut pending: Vec<&[u8]> = Vec::new();
    let mut segments = 0;
    for (index, packet) in track.packets.iter().enumerate() {
        if segments + lacing_segments(packet) > 255 {
            page(&mut out, &pending, granule, sequence, 0x00);
            (pending, segments, sequence) = (Vec::new(), 0, sequence + 1);
        }
        granule += samples(packet);
        segments += lacing_segments(packet);
        pending.push(packet);
        if index + 1 == track.packets.len() {
            page(&mut out, &pending, granule, sequence, 0x04);
        }
    }
    let seconds = (granule.saturating_sub(pre_skip) as f64 / 48_000.0).round() as i64;
    Some(OggVoice { bytes: out, seconds })
}
