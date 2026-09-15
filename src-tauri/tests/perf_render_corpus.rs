//! 阶段 3 门禁二「渲染面」测量器（一次性调查脚手架，不是回归测试）。
//!
//! 它不断言任何阈值 —— E39/G0 明确禁止把毫秒数变成阻塞门禁。它只打印数字，
//! 供 docs/plans/20260915-stage3-gate2-runbook.md §8 的记录表填写。
//!
//! 为什么 `#[ignore]`：语料在 `.perf-corpus/`，被 gitignore，新克隆里不存在。
//! 默认跑就会失败，那是环境缺失不是缺陷。
//!
//! 为什么不用 criterion：G0 无新依赖。`std::time::Instant` 对 10MB 量级的
//! 输入足够 —— 我们要区分的是 3ms 和 300ms，不是 3µs 和 4µs。
//!
//! 为什么 render 和 sanitize 分开计时：计划 M §2.5 判断 ammonia 才是真正的
//! 成本边界。合并计时无法证伪这个判断，分开计时才能。
//!
//! 运行：
//!   node scripts/perf/generate-corpus.mjs --check
//!   cd src-tauri && cargo test --test perf_render_corpus -- --ignored --nocapture

#[test]
#[ignore = "需要 .perf-corpus/，先跑 node scripts/perf/generate-corpus.mjs"]
fn perf_render_corpus() {
    use std::time::Instant;

    const REPEATS: usize = 5;

    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri 必有父目录")
        .join(".perf-corpus");

    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("读不到 {}：{e}；先生成语料", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "md").unwrap_or(false))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "{} 里没有 .md 语料", dir.display());

    // 首次调用单列：冷路径（分配器预热、ammonia 的 lazy 静态）与稳态是两回事，
    // 合并成中位数会把它抹掉，而用户感知到的恰恰是首次。
    println!(
        "\nfile\tbytes\trender_p50_ms\trender_first_ms\tsanitize_p50_ms\tsanitize_first_ms\thtml_bytes"
    );

    for path in &files {
        let md = std::fs::read_to_string(path).expect("语料可读");

        let mut render = Vec::with_capacity(REPEATS);
        let mut sanitize = Vec::with_capacity(REPEATS);
        let mut html_len = 0usize;

        for _ in 0..REPEATS {
            let t = Instant::now();
            let html = tauri_app_lib::services::markdown::render_markdown(&md);
            render.push(t.elapsed().as_secs_f64() * 1000.0);
            html_len = html.len();

            let t = Instant::now();
            let clean = tauri_app_lib::services::markdown::sanitize_html(&html);
            sanitize.push(t.elapsed().as_secs_f64() * 1000.0);
            std::hint::black_box(clean);
        }

        let (r_first, s_first) = (render[0], sanitize[0]);
        let median = |v: &mut Vec<f64>| {
            v.sort_by(|a, b| a.partial_cmp(b).expect("计时不会是 NaN"));
            v[v.len() / 2]
        };
        let r_p50 = median(&mut render);
        let s_p50 = median(&mut sanitize);

        println!(
            "{}\t{}\t{:.1}\t{:.1}\t{:.1}\t{:.1}\t{}",
            path.file_name().expect("有文件名").to_string_lossy(),
            md.len(),
            r_p50,
            r_first,
            s_p50,
            s_first,
            html_len
        );
    }

    println!("\n(repeats={REPEATS}，p50 为中位数；本测试不设阈值，见 E39)");
}
