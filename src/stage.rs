//! 9:16 미리보기 무대 (기존 template.js updateTemplatePreview + 흐린 배경 미리보기).
//! 템플릿 층(배경·제목·꼬리말·자막)은 내보내기와 같은 그리기 엔진으로 따로 일꾼 스레드에서 그리고,
//! 그린 부분만 잘라 텍스처로 올린다. 영상 화면은 매 프레임 영상 상자에 맞춰 겹친다.
use eframe::egui::{self, Color32, ColorImage, Pos2, Rect, TextureHandle, TextureOptions};
use sermon_shorts::template::{self, OwnedParams};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::mpsc::{channel, Receiver, Sender};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind { Base = 0, Over = 1, Sub = 2 }

struct Job { kind: Kind, key: u64, params: OwnedParams }
struct Done { kind: Kind, key: u64, img: Option<ColorImage>, rect: Rect, hits: Vec<template::Hit> }

#[derive(Clone)]
pub struct Layer { pub key: u64, pub tex: Option<TextureHandle>, pub rect: Rect, pub hits: Vec<template::Hit> }

pub fn hkey(s: &str) -> u64 { let mut h = DefaultHasher::new(); s.hash(&mut h); h.finish() }

pub fn tex_options() -> TextureOptions { TextureOptions { mipmap_mode: Some(egui::TextureFilter::Linear), ..TextureOptions::LINEAR } }

pub struct Stage {
    tx: Sender<Job>,
    rx: Receiver<Done>,
    pub layers: [Option<Layer>; 3],
    wanted: [u64; 3],
    pending: [Option<u64>; 3],
    sub_cache: Vec<Layer>,
    pub blur: Option<TextureHandle>,
    blur_at: Option<std::time::Instant>,
    blur_frame: u64,
}

impl Stage {
    pub fn new(ctx: &egui::Context) -> Stage {
        let (tx, jrx) = channel::<Job>();
        let (dtx, rx) = channel::<Done>();
        let ctx2 = ctx.clone();
        std::thread::Builder::new().name("stage".into()).spawn(move || {
            while let Ok(first) = jrx.recv() {
                // 밀린 일은 종류마다 마지막 것만 그린다
                let mut latest: [Option<Job>; 3] = [None, None, None];
                let k = first.kind as usize;
                latest[k] = Some(first);
                while let Ok(j) = jrx.try_recv() { let k = j.kind as usize; latest[k] = Some(j); }
                for j in latest.into_iter().flatten() {
                    let layers: &[&str] = match j.kind { Kind::Base => &["background", "under"], Kind::Over => &["top", "footer"], Kind::Sub => &["subtitle"] };
                    let (pm, hits) = template::render_hits(layers, &j.params);
                    let (w, h) = (template::W, template::H);
                    let bbox = if j.kind == Kind::Base { Some((0, 0, w - 1, h - 1)) } else { template::alpha_bbox(&pm) };
                    let (img, rect) = match bbox {
                        None => (None, Rect::NOTHING),
                        Some((x0, y0, x1, y1)) => {
                            let (cw, ch) = (x1 - x0 + 1, y1 - y0 + 1);
                            let d = pm.data();
                            let mut buf = Vec::with_capacity((cw * ch * 4) as usize);
                            for y in y0..=y1 { let s = ((y * w + x0) * 4) as usize; buf.extend_from_slice(&d[s..s + (cw * 4) as usize]); }
                            (Some(ColorImage::from_rgba_premultiplied([cw as usize, ch as usize], &buf)), Rect::from_min_max(Pos2::new(x0 as f32, y0 as f32), Pos2::new((x1 + 1) as f32, (y1 + 1) as f32)))
                        }
                    };
                    if dtx.send(Done { kind: j.kind, key: j.key, img, rect, hits }).is_err() { return; }
                    ctx2.request_repaint();
                }
            }
        }).expect("stage thread");
        Stage { tx, rx, layers: [None, None, None], wanted: [0; 3], pending: [None; 3], sub_cache: vec![], blur: None, blur_at: None, blur_frame: u64::MAX }
    }

    /// 이 층이 key 그림이어야 한다. 그리기를 맡겨야 하면 true (그동안은 앞 그림을 보인다)
    pub fn want(&mut self, kind: Kind, key: u64) -> bool {
        let k = kind as usize;
        self.wanted[k] = key;
        if self.layers[k].as_ref().map(|l| l.key) == Some(key) { return false; }
        if kind == Kind::Sub {
            if let Some(pos) = self.sub_cache.iter().position(|l| l.key == key) {
                let l = self.sub_cache.remove(pos);
                self.layers[k] = Some(l.clone());
                self.sub_cache.push(l);
                return false;
            }
        }
        self.pending[k] != Some(key)
    }
    pub fn send(&mut self, kind: Kind, key: u64, params: OwnedParams) {
        self.pending[kind as usize] = Some(key);
        let _ = self.tx.send(Job { kind, key, params });
    }
    /// 다 그린 층을 텍스처로
    pub fn poll(&mut self, ctx: &egui::Context) {
        while let Ok(d) = self.rx.try_recv() {
            let k = d.kind as usize;
            if self.pending[k] == Some(d.key) { self.pending[k] = None; }
            let tex = d.img.map(|img| ctx.load_texture(format!("stage{k}"), img, tex_options()));
            let layer = Layer { key: d.key, tex, rect: d.rect, hits: d.hits };
            if d.kind == Kind::Sub {
                self.sub_cache.retain(|l| l.key != d.key);
                self.sub_cache.push(layer.clone());
                if self.sub_cache.len() > 40 { self.sub_cache.remove(0); }
            }
            if self.wanted[k] == d.key || self.layers[k].is_none() { self.layers[k] = Some(layer); }
        }
    }

    /// 테마가 바뀌면 자막 그림 기억을 비운다
    pub fn clear_subs(&mut self) { self.sub_cache.clear(); }

    /// 흐린 배경: 영상 화면을 270×480 에 꽉 채우고 흐리게·어둡게 (크롬 미리보기와 같은 방식). 재생 중에는 0.1초마다
    pub fn update_blur(&mut self, ctx: &egui::Context, frame_no: u64, rgba: &[u8], fw: usize, fh: usize, amount: f64, dim: f64, playing: bool) {
        if frame_no == self.blur_frame { return; }
        if playing && self.blur_at.is_some_and(|t| t.elapsed().as_millis() < 100) { return; }
        self.blur_frame = frame_no;
        self.blur_at = Some(std::time::Instant::now());
        let (ow, oh) = (270usize, 480usize);
        if fw == 0 || fh == 0 || rgba.len() < fw * fh * 4 { return; }
        let s = (ow as f64 / fw as f64).max(oh as f64 / fh as f64);
        let (sw, sh) = (fw as f64 * s, fh as f64 * s);
        let (ox, oy) = ((ow as f64 - sw) / 2.0, (oh as f64 - sh) / 2.0);
        let mut planes = [vec![0f32; ow * oh], vec![0f32; ow * oh], vec![0f32; ow * oh]];
        for y in 0..oh {
            let sy = (((y as f64 + 0.5 - oy) / s) as isize).clamp(0, fh as isize - 1) as usize;
            for x in 0..ow {
                let sx = (((x as f64 + 0.5 - ox) / s) as isize).clamp(0, fw as isize - 1) as usize;
                let i = (sy * fw + sx) * 4;
                for c in 0..3 { planes[c][y * ow + x] = rgba[i + c] as f32; }
            }
        }
        let sigma = (amount / 4.0).max(0.0) as f32;
        for p in planes.iter_mut() { box_blur3(p, ow, oh, sigma); }
        let k = (1.0 - dim).clamp(0.0, 1.0) as f32;
        let mut out = Vec::with_capacity(ow * oh * 4);
        for i in 0..ow * oh { for c in 0..3 { out.push((planes[c][i] * k).round().clamp(0.0, 255.0) as u8); } out.push(255); }
        let img = ColorImage::from_rgba_unmultiplied([ow, oh], &out);
        match &mut self.blur { Some(t) => t.set(img, TextureOptions::LINEAR), None => self.blur = Some(ctx.load_texture("stage-blur", img, TextureOptions::LINEAR)) }
    }
}

/// 상자 흐림 3번 (가우스 흐림 근사)
fn box_blur3(a: &mut [f32], w: usize, h: usize, sigma: f32) {
    if sigma < 0.3 { return; }
    let n = 3.0f32;
    let wl = ((12.0 * sigma * sigma / n + 1.0).sqrt()).floor() as i32;
    let wl = if wl % 2 == 0 { wl - 1 } else { wl };
    let wu = wl + 2;
    let m = ((12.0 * sigma * sigma - n * (wl * wl) as f32 - 4.0 * n * wl as f32 - 3.0 * n) / (-4.0 * wl as f32 - 4.0)).round() as i32;
    let mut tmp = vec![0f32; a.len()];
    for i in 0..3 {
        let r = ((if i < m { wl } else { wu }) - 1) / 2;
        if r <= 0 { continue; }
        pass(a, &mut tmp, w, h, r as usize, true);
        pass(&tmp, a, w, h, r as usize, false);
    }
    fn pass(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize, horiz: bool) {
        let (outer, inner) = if horiz { (h, w) } else { (w, h) };
        let idx = |o: usize, i: usize| if horiz { o * w + i } else { i * w + o };
        let d = (2 * r + 1) as f32;
        for o in 0..outer {
            // 가장자리는 끝 값을 늘려 쓴다 (어두운 테두리가 생기지 않게)
            let at = |i: isize| src[idx(o, i.clamp(0, inner as isize - 1) as usize)];
            let mut acc = 0.0f32;
            for i in -(r as isize)..=(r as isize) { acc += at(i); }
            for i in 0..inner as isize {
                dst[idx(o, i as usize)] = acc / d;
                acc += at(i + r as isize + 1) - at(i - r as isize);
            }
        }
    }
}

/// 둥근 모서리 바깥을 바탕색으로 덮는다 (무대 모서리 둥글게)
pub fn round_corners(painter: &egui::Painter, rect: Rect, r: f32, bg: Color32) {
    if r <= 0.0 { return; }
    let steps = 10;
    let corners = [(rect.left_top(), egui::vec2(1.0, 1.0)), (rect.right_top(), egui::vec2(-1.0, 1.0)), (rect.right_bottom(), egui::vec2(-1.0, -1.0)), (rect.left_bottom(), egui::vec2(1.0, -1.0))];
    for (c, d) in corners {
        let center = c + egui::vec2(d.x * r, d.y * r);
        let mut mesh = egui::Mesh::default();
        mesh.colored_vertex(c, bg);
        for i in 0..=steps {
            let a = std::f32::consts::FRAC_PI_2 * i as f32 / steps as f32;
            // 모서리 쪽 사분원: (−d.x, −d.y) 방향 기준
            let p = center + egui::vec2(-d.x * r * a.cos(), -d.y * r * a.sin());
            mesh.colored_vertex(p, bg);
        }
        for i in 1..=steps as u32 { mesh.add_triangle(0, i, i + 1); }
        painter.add(egui::Shape::mesh(mesh));
    }
}
