fn main() {
    let t = std::time::Instant::now();
    let r = sermon_shorts::syscheck::check_system(false);
    for x in &r.rows { println!("{:<6} {:<22} {} | {}", x.status.as_str(), x.name, x.value, x.actions.join(",")); }
    println!("critical={} ({:.1}초)", r.critical, t.elapsed().as_secs_f64());
}
