import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const size = Math.max(1, Math.min(10000, Number(process.env.NOTE_SIZE || process.argv[2]) || 5000));
const days = Math.max(1, Math.min(60, Number(process.env.NOTE_DAYS || process.argv[3]) || 28));
const perQuerySort = Math.max(40, Number(process.env.NOTE_PER_QUERY || 50));
const queries = (process.env.NOTE_QUERIES || "有料note,note販売,note収益化,テンプレート,ロードマップ,完全版,教材,副業,フリーランス,コンテンツ販売,在宅ワーク,コーチング,案件獲得,Webライター,恋愛,婚活,マッチングアプリ,モテ,復縁,キャリア,転職,職務経歴書,年収UP,未経験転職,英語学習,TOEIC,プログラミング,資格,独学,ダイエット,筋トレ,スキンケア,メンタルヘルス,食事管理,AI活用,ChatGPT,プロンプト,生成AI,画像生成,自動化,NISA,高配当株,インデックス投資,仮想通貨,節約,資産形成,SNS運用,Instagram,X運用,TikTok,起業,マーケティング,営業")
  .split(",")
  .map((query) => query.trim())
  .filter(Boolean);

const genres = [
  { name: "AI活用・プロンプト", words: ["AI", "生成AI", "ChatGPT", "GPT", "Gemini", "Claude", "プロンプト", "自動化", "業務効率", "AIライター", "AIライティング", "画像生成", "エージェント"] },
  { name: "投資・資産形成", words: ["投資", "資産", "NISA", "株", "高配当", "インデックス", "不動産", "家計", "節約", "お金", "貯金", "保険", "税金", "FX", "仮想通貨"] },
  { name: "note販売・運用", words: ["note販売", "有料note", "有料記事", "価格設計", "導線", "スキ", "フォロワー", "収益化", "マガジン", "note運用"] },
  { name: "副業・稼ぎ方", words: ["副業", "収益", "稼ぐ", "マネタイズ", "コンテンツ販売", "在宅", "フリーランス", "案件", "営業", "コーチング", "コンサル"] },
  { name: "SNS・発信運用", words: ["SNS", "インスタ", "発信", "フォロワー", "ライティング", "ブログ", "バズ", "インフルエンサー", "コンテンツ", "企画"] },
  { name: "キャリア・転職", words: ["転職", "キャリア", "面接", "職務経歴書", "就活", "年収", "未経験", "仕事術", "退職", "昇進", "スキルアップ"] },
  { name: "恋愛・婚活", words: ["恋愛", "婚活", "マッチングアプリ", "結婚", "復縁", "デート", "モテ", "パートナー", "告白", "恋人", "好き"] },
  { name: "学習・資格", words: ["勉強", "資格", "英語", "TOEIC", "受験", "学習", "試験", "暗記", "独学", "合格", "語学"] },
  { name: "健康・美容", words: ["健康", "美容", "ダイエット", "筋トレ", "食事", "睡眠", "メンタル", "スキンケア", "習慣", "運動", "ヨガ", "ストレス"] },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function compactText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function noteUrl(item) {
  const urlname = item.user?.urlname;
  if (!urlname || !item.key) return "";
  return `https://note.com/${urlname}/n/${item.key}`;
}

function classify(item) {
  const text = `${item.title} ${item.body}`.toLowerCase();
  const ranked = genres.map((genre) => {
    const hits = genre.words.reduce((sum, word) => {
      const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return sum + (text.match(new RegExp(escaped, "g")) || []).length;
    }, 0);
    return { genre, hits };
  }).sort((a, b) => b.hits - a.hits);
  return ranked[0].hits > 0 ? ranked[0].genre.name : "その他";
}

function isSubscription(item) {
  if (item.price_info?.has_subscription) return true;
  if (item.price_info?.is_free === false && !item.price_info?.oneshot_lowest_price) return true;
  const text = `${item.title} ${item.body}`.toLowerCase();
  return /定期購読|マガジン購読|サブスク|メンバーシップ|月額会員|購読者限定/.test(text);
}

function paidSignal(item) {
  if (isSubscription(item)) return false;
  const text = `${item.title} ${item.body} ${item.soldSignal || ""}`.toLowerCase();
  return item.price > 0 || ["有料", "販売", "購入", "売れて", "高評価", "テンプレ", "講座", "ロードマップ", "完全版", "限定", "教材"].some((word) => text.includes(word.toLowerCase()));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchSearch(query, sort, limit) {
  const found = [];
  const seen = new Set();
  const pageSize = 20;

  for (let start = 0; found.length < limit; start += pageSize) {
    const params = new URLSearchParams({ context: "note", q: query, sort, size: String(pageSize), start: String(start), paid: "true" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(`https://note.com/api/v3/searches?${params.toString()}`, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 weekly-note-tracker" },
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      await sleep(500);
      break; // このソートをスキップして次へ
    }
    clearTimeout(timer);
    await sleep(150);
    if (!response.ok) break;

    const json = await response.json();
    const contents = json?.data?.notes?.contents || [];
    if (!contents.length) break;

    for (const item of contents) {
      const key = item.key || item.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(item);
      if (found.length >= limit) break;
    }
  }

  return found;
}

async function fetchNoteDetail(noteKey) {
  if (!noteKey) return null;
  try {
    const apiUrl = `https://note.com/api/v3/notes/${noteKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(apiUrl, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 weekly-note-tracker" },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    let json;
    try { json = await response.json(); } catch { return null; }
    const d = json?.data;
    if (!d) return null;

    // 購入シグナル
    const signals = [];
    if (d.is_purchased_within_last_24_hours) signals.push("24h購入確認");
    if (d.is_recently_purchased) signals.push("最近購入あり");

    // ユーザー特徴（フォロワー数・投稿数）
    const u = d.user || {};
    const followers = Number(u.follower_count || 0);
    const noteCount = Number(u.note_count || 0);
    const userProfile = followers > 0 || noteCount > 0
      ? `フォロワー${followers >= 10000 ? (followers / 10000).toFixed(1) + "万" : followers}・投稿${noteCount}本`
      : "";

    return {
      soldSignal: [...new Set(signals)].join(" / "),
      hasBuySignal: signals.some(s => s.includes("24h") || s.includes("最近")),
      userProfile
    };
  } catch {
    return null;
  }
}

const previous = await readJson("note-history.json", { items: [] });
const previousLikes = new Map((previous.items || []).map((item) => [item.key || item.url, Number(item.likes || 0)]));
const since = Date.now() - days * 24 * 60 * 60 * 1000;
const raw = [];
const seenGlobal = new Set();

async function writeProgress(data) {
  try {
    await fs.writeFile(path.join(root, "collect-progress.json"), JSON.stringify(data), "utf8");
  } catch { /* ignore */ }
}

let queryCount = 0;
await writeProgress({ running: true, current: 0, total: queries.length, collected: 0, currentQuery: "" });

for (const query of queries) {
  queryCount++;
  process.stdout.write(`\r収集中... ${queryCount}/${queries.length} クエリ (取得済み: ${seenGlobal.size}件)`);
  await writeProgress({ running: true, current: queryCount, total: queries.length, collected: seenGlobal.size, currentQuery: query });
  for (const sort of ["popular", "like", "hot", "new"]) {
    const batch = await fetchSearch(query, sort, perQuerySort);
    for (const item of batch) {
      const key = item.key || item.id;
      if (!key || seenGlobal.has(key)) continue;
      seenGlobal.add(key);
      raw.push({ item, query, sort });
    }
  }
}

let items = raw.map(({ item, query, sort }) => {
  const url = noteUrl(item);
  const key = item.key || String(item.id || url);
  const publishedAt = item.publish_at || "";
  const author = item.user?.nickname || "";
  const title = item.name || "無題";
  const body = [publishedAt, compactText(item.description || item.body || item.highlight || item.category?.name || "")]
    .filter(Boolean)
    .join(" / ");
  const likes = Number(item.like_count || 0);
  const price = Number(item.price_info?.oneshot_lowest_price || item.price || 0);
  return {
    key,
    title,
    author,
    body,
    likes,
    price,
    url,
    publishedAt,
    genre: "",
    likeDelta: previousLikes.has(key) ? likes - previousLikes.get(key) : Math.round(likes * 0.1),
    soldSignal: "",
    hasBuySignal: false,
    userProfile: "",
    sourceQuery: query,
    sourceSort: sort
  };
});

const recent = items.filter((item) => {
  const time = Date.parse(item.publishedAt);
  return Number.isFinite(time) && time >= since;
});
if (recent.length >= 30) items = recent;

items = items
  .filter((item) => !isSubscription(item))
  .map((item) => ({ ...item, genre: classify(item) }))
  .sort((a, b) => {
    const aScore = (a.likeDelta * 2) + a.likes + (a.price > 0 ? 80 : 0);
    const bScore = (b.likeDelta * 2) + b.likes + (b.price > 0 ? 80 : 0);
    return bScore - aScore;
  })
  .slice(0, size);

// 全有料記事にシグナルチェック＋ユーザー情報取得
const paidItems = items.filter(item => item.price > 0);
console.log(`\nシグナルチェック開始: 有料${paidItems.length}件`);
let signalChecked = 0;
for (const item of paidItems) {
  signalChecked++;
  if (signalChecked % 10 === 0) {
    process.stdout.write(`\rシグナルチェック中... ${signalChecked}/${paidItems.length}件`);
    await writeProgress({ running: true, current: queries.length, total: queries.length, collected: items.length, currentQuery: `シグナルチェック ${signalChecked}/${paidItems.length}件`, phase: "signal" });
  }
  const detail = await fetchNoteDetail(item.key);
  if (detail) {
    item.soldSignal = detail.soldSignal;
    item.hasBuySignal = detail.hasBuySignal;
    item.userProfile = detail.userProfile;
  }
  item.disclosedCount = (() => {
    const m = (item.soldSignal || "").match(/購入([0-9,]+)件/);
    return m ? Number(m[1].replace(/,/g, "")) : 0;
  })();
  await sleep(300);
}

function scoreItem(item) {
  const buyBonus = item.hasBuySignal ? 300 : 0;
  const countBonus = Math.min(item.disclosedCount || 0, 500) * 0.5;
  return Math.round(buyBonus + countBonus + (item.likes * 0.5) + (item.price > 0 ? 80 : 0));
}

const grouped = new Map();
for (const item of items) {
  if (!grouped.has(item.genre)) grouped.set(item.genre, []);
  grouped.get(item.genre).push(item);
}

const topGenres = [...grouped.entries()].map(([genre, posts]) => {
  const count = posts.length;
  const avgLikes = posts.reduce((sum, post) => sum + post.likes, 0) / count;
  const avgDelta = posts.reduce((sum, post) => sum + post.likeDelta, 0) / count;
  const paidRate = posts.filter((post) => post.price > 0).length / count;
  const soldSignalRate = posts.filter(paidSignal).length / count;
  const trendScore = Math.round((avgDelta * 2.2) + (avgLikes * 1.1) + (paidRate * 55) + (soldSignalRate * 80) + Math.min(count, 20) * 3);
  const reasons = [];
  if (avgDelta >= 20) reasons.push("週間スキ増加が強い");
  if (avgLikes >= 80) reasons.push("平均スキが高い");
  if (paidRate > 0) reasons.push("有料記事が含まれる");
  if (soldSignalRate >= 0.25) reasons.push("販売/高評価シグナルがある");
  return {
    genre,
    count,
    avgLikes: Number(avgLikes.toFixed(1)),
    avgDelta: Number(avgDelta.toFixed(1)),
    paidRate: Number(paidRate.toFixed(2)),
    soldSignalRate: Number(soldSignalRate.toFixed(2)),
    trendScore,
    reason: reasons.join(" / ") || "反応の強さと有料化余地のバランスが良い",
    examples: posts.slice().sort((a, b) => scoreItem(b) - scoreItem(a)).slice(0, 4)
  };
}).sort((a, b) => b.trendScore - a.trendScore).slice(0, 5);

const csv = [
  "title,author,body,likes,price,url,publishedAt,genre,likeDelta,soldSignal,sourceQuery,key",
  ...items.map((item) => [
    item.title,
    item.author,
    item.body,
    item.likes,
    item.price,
    item.url,
    item.publishedAt,
    item.genre,
    item.likeDelta,
    item.soldSignal,
    item.sourceQuery,
    item.key
  ].map(csvCell).join(","))
].join("\n");

const payload = {
  mode: "weekly-trends",
  queries,
  days,
  size,
  updatedAt: new Date().toISOString(),
  items
};

await fs.writeFile(path.join(root, "note-collected.csv"), csv, "utf8");
await fs.writeFile(path.join(root, "note-collected.json"), JSON.stringify(payload, null, 2), "utf8");
// note-history.json は自動上書きしない。レポート投稿後に手動で更新すること。
await fs.writeFile(path.join(root, "note-top-genres.json"), JSON.stringify({ ...payload, topGenres }, null, 2), "utf8");
await fs.writeFile(path.join(root, "note-top-genres.md"), [
  "# 週間note売れ筋候補レポート",
  "",
  `対象: 直近${days}日 / ジャンル制限なしで広く収集`,
  `収集件数: ${items.length}`,
  `更新日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
  "",
  ...topGenres.flatMap((genre, index) => [
    `## ${index + 1}. ${genre.genre}`,
    "",
    `- 週間推定スコア: ${genre.trendScore}`,
    `- 投稿数: ${genre.count}`,
    `- 平均スキ: ${genre.avgLikes}`,
    `- 平均スキ増加: ${genre.avgDelta}`,
    `- 有料率: ${Math.round(genre.paidRate * 100)}%`,
    `- 販売/高評価シグナル率: ${Math.round(genre.soldSignalRate * 100)}%`,
    `- 理由: ${genre.reason}`,
    "",
    "参考note:",
    ...genre.examples.map((post) => `- ${post.title} (${post.likes}スキ / +${post.likeDelta}) ${post.url}`),
    ""
  ])
].join("\n"), "utf8");

await writeProgress({ running: false, current: queries.length, total: queries.length, collected: items.length, currentQuery: "" });
process.stdout.write("\n");
console.log(`${items.length}件を週間収集しました（重複除外後）`);
console.log(`売れ筋候補: ${topGenres.map((genre) => genre.genre).join(" / ")}`);
