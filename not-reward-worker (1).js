const ADMIN_ID = "6861548933";
const BOT_USERNAME = "notrewarddbot";
// اگر در BotFather با /newapp مینی‌اپ ساختی، اسم کوتاهش را اینجا بنویس. اگر خالی بماند از Main Mini App استفاده می‌شود.
const MINI_APP_NAME = "rewardapp";

// همه مقادیر به "واحد" هستند. هر ۱۰۰ واحد = ۱ NOT
const TAP_REWARD = 2;
const DAILY_TAP_LIMIT = 500;
const REFERRAL_REWARD = 500;      // ۵ NOT
const MIN_WITHDRAWAL = 5000;      // ۵۰ NOT
const NETWORK_FEE = 1500;         // ۱۵ NOT
const MIN_ADS_FOR_WITHDRAWAL = 5;
const MONETAG_REWARD = 50;        // ۰٫۵ NOT
const TASK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // هر ۲۴ ساعت یک‌بار

// ===== جایزه روزانه: روز ۱ تا ۷ (به واحد) =====
const DAILY_REWARDS_UNITS = [100, 200, 300, 400, 500, 600, 700]; // ۱ تا ۷ NOT
// اگر true باشد و کاربر یک روز را جا بیندازد، از روز ۱ شروع می‌شود.
// اگر false باشد، از همان روزی که بود ادامه می‌دهد.
const RESET_STREAK_ON_MISS = true;

// ===== تسک‌های کانال =====
// ⚠️ ربات باید در هر دو کانال ادمین باشد.
// کلید (channel_1 و ...) باید با id داخل فایل index.html یکی باشد.
const TASKS = {
  channel_1: { chat: "@WithdrawNott", reward: 500, title: "کانال واریزها (Withdrawals)" }, // ۵ NOT / ۲۴h
  channel_2: { chat: "@NOTREWARR", reward: 500, title: "کانال اطلاع‌رسانی (Announcements)" }  // ۵ NOT / ۲۴h
};

const ALLOWED_ORIGIN = "https://mukefaceget15-web.github.io";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
  "Vary": "Origin"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

// بررسی Origin (درخواست‌های سرور به سرور مثل postback مانتگ Origin ندارند)
function cors(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === ALLOWED_ORIGIN;
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(message)
    )
  );
}

function hex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function equalSafe(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || authDate > now + 60 || now - authDate > 86400) {
    return null;
  }

  params.delete("hash");

  const checkString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmac(
    new TextEncoder().encode("WebAppData"),
    botToken
  );

  const calculatedHash = hex(await hmac(secretKey, checkString));

  if (!equalSafe(calculatedHash, receivedHash.toLowerCase())) {
    return null;
  }

  let telegramUser;

  try {
    telegramUser = JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }

  if (!telegramUser || !telegramUser.id) return null;

  return {
    id: String(telegramUser.id),
    first_name: String(telegramUser.first_name || ""),
    username: telegramUser.username ? String(telegramUser.username) : null,
    start_param: String(params.get("start_param") || "")
  };
}

async function requireUser(request, body, env) {
  const initData =
    request.headers.get("X-Telegram-Init-Data") ||
    body?.initData ||
    "";

  const user = await verifyTelegramInitData(initData, env.BOT_TOKEN);

  if (!user) {
    const error = new Error(
      "اعتبار تلگرام تأیید نشد. برنامه را از داخل ربات تلگرام باز کن."
    );
    error.status = 401;
    throw error;
  }

  return user;
}

let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL DEFAULT '',
      username TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      referred_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_daily TEXT,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      tap_count INTEGER NOT NULL DEFAULT 0,
      tap_date TEXT
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_units INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // اگر جدول withdrawals قدیمی (با ساختار متفاوت) وجود دارد، به‌جای حذف، نام آن را عوض می‌کنیم
  const legacyInfo = await db.prepare("PRAGMA table_info(withdrawals)").all();
  const legacyCols = new Set((legacyInfo.results || []).map(c => c.name));

  if (legacyCols.size > 0 && !legacyCols.has("user_id")) {
    await db.prepare("DROP INDEX IF EXISTS idx_withdrawals_user").run();
    await db.prepare(
      `ALTER TABLE withdrawals RENAME TO withdrawals_legacy_${Date.now()}`
    ).run();
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      amount_units INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id TEXT NOT NULL,
      invited_id TEXT NOT NULL UNIQUE,
      reward_units INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ad_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      reward_units INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // جدول تسک‌های انجام‌شده (هر کاربر هر تسک را فقط یک بار)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS task_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      reward_units INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, task_id)
    )
  `).run();

  // ارتقای جدول قدیمی users بدون حذف کاربران یا موجودی‌ها
  const info = await db.prepare("PRAGMA table_info(users)").all();
  const columns = new Set((info.results || []).map(c => c.name));

  const migrations = [
    ["first_name", "TEXT NOT NULL DEFAULT ''"],
    ["username", "TEXT"],
    ["balance", "INTEGER NOT NULL DEFAULT 0"],
    ["referred_by", "TEXT"],
    ["created_at", "TEXT"],
    ["last_daily", "TEXT"],
    ["daily_streak", "INTEGER NOT NULL DEFAULT 0"],
    ["tap_count", "INTEGER NOT NULL DEFAULT 0"],
    ["tap_date", "TEXT"]
  ];

  for (const [name, definition] of migrations) {
    if (!columns.has(name)) {
      await db.prepare(
        `ALTER TABLE users ADD COLUMN ${name} ${definition}`
      ).run();
    }
  }

  // ستون‌های لازم برای پنل مدیریت و کارمزد برداشت
  const wInfo = await db.prepare("PRAGMA table_info(withdrawals)").all();
  const wColumns = new Set((wInfo.results || []).map(c => c.name));

  for (const [name, definition] of [
    ["processed_at", "TEXT"],
    ["admin_note", "TEXT"],
    ["tx_hash", "TEXT"],
    ["fee_units", "INTEGER NOT NULL DEFAULT 0"]
  ]) {
    if (!wColumns.has(name)) {
      await db.prepare(
        `ALTER TABLE withdrawals ADD COLUMN ${name} ${definition}`
      ).run();
    }
  }

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_history_user
    ON history(user_id, id DESC)
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user
    ON withdrawals(user_id, id DESC)
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_ad_events_user
    ON ad_events(user_id)
  `).run();

  schemaReady = true;
}

async function getUser(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?")
    .bind(String(id))
    .first();
}

// تعداد تبلیغ‌های تأییدشده برای یک کاربر
async function getAdsWatched(db, userId) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS c FROM ad_events WHERE user_id = ?"
  ).bind(String(userId)).first();
  return Number(row?.c || 0);
}

async function addHistory(db, userId, kind, amountUnits, details = "") {
  await db.prepare(`
    INSERT INTO history (user_id, kind, amount_units, details)
    VALUES (?, ?, ?, ?)
  `).bind(
    String(userId),
    String(kind),
    Math.trunc(Number(amountUnits) || 0),
    String(details)
  ).run();
}

async function createUser(db, user, startParam = "") {
  const existing = await getUser(db, user.id);

  if (existing) {
    await db.prepare(`
      UPDATE users SET first_name = ?, username = ? WHERE id = ?
    `).bind(
      user.first_name,
      user.username,
      user.id
    ).run();

    return getUser(db, user.id);
  }

  let inviterId = null;
  const match = String(startParam).match(/^ref_(\d+)$/);

  if (match && match[1] !== user.id) {
    const inviter = await getUser(db, match[1]);
    if (inviter) inviterId = match[1];
  }

  await db.prepare(`
    INSERT OR IGNORE INTO users (id, first_name, username, balance, referred_by)
    VALUES (?, ?, ?, 0, ?)
  `).bind(
    user.id,
    user.first_name,
    user.username,
    inviterId
  ).run();

  if (inviterId) {
    const inserted = await db.prepare(`
      INSERT OR IGNORE INTO referrals
        (inviter_id, invited_id, reward_units)
      VALUES (?, ?, ?)
    `).bind(
      inviterId,
      user.id,
      REFERRAL_REWARD
    ).run();

    if (Number(inserted.meta?.changes || 0) === 1) {
      await db.prepare(`
        UPDATE users SET balance = balance + ? WHERE id = ?
      `).bind(REFERRAL_REWARD, inviterId).run();

      await addHistory(
        db,
        inviterId,
        "referral",
        REFERRAL_REWARD,
        `پاداش دعوت کاربر ${user.id}`
      );
    }
  }

  return getUser(db, user.id);
}

function buildReferralLink(userId) {
  const base = MINI_APP_NAME
    ? `https://t.me/${BOT_USERNAME}/${MINI_APP_NAME}`
    : `https://t.me/${BOT_USERNAME}`;
  return `${base}?startapp=ref_${userId}`;
}

function toNot(units) {
  return Number(units || 0) / 100;
}

function publicUser(user) {
  return {
    id: String(user.id),
    first_name: user.first_name || "",
    username: user.username || null
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUTC() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

// ===================== جایزه روزانه =====================

function dailyState(user) {
  const today = todayUTC();
  const last = user.last_daily || null;
  let streak = Math.max(0, Math.min(7, Number(user.daily_streak || 0)));

  if (last === today) {
    return { claimedDays: streak, canClaim: false };
  }

  if (streak >= 7) {
    return { claimedDays: 0, canClaim: true };
  }

  if (last && last !== yesterdayUTC() && RESET_STREAK_ON_MISS) {
    return { claimedDays: 0, canClaim: true };
  }

  return { claimedDays: last ? streak : 0, canClaim: true };
}

async function handleDailyStatus(current) {
  const state = dailyState(current);

  return json({
    ok: true,
    claimedDays: state.claimedDays,
    canClaim: state.canClaim,
    nextReward: state.canClaim
      ? toNot(DAILY_REWARDS_UNITS[state.claimedDays])
      : null,
    rewards: DAILY_REWARDS_UNITS.map(toNot),
    balance: toNot(current.balance)
  });
}

async function handleDailyClaim(db, current) {
  const state = dailyState(current);

  if (!state.canClaim) {
    return json({ ok: false, error: "جایزه امروز را قبلاً دریافت کرده‌ای." }, 409);
  }

  const dayNumber = state.claimedDays + 1;
  const reward = DAILY_REWARDS_UNITS[dayNumber - 1];
  const today = todayUTC();

  const update = await db.prepare(`
    UPDATE users
    SET balance = balance + ?, last_daily = ?, daily_streak = ?
    WHERE id = ? AND (last_daily IS NULL OR last_daily != ?)
  `).bind(reward, today, dayNumber, current.id, today).run();

  if (Number(update.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "جایزه امروز را قبلاً دریافت کرده‌ای." }, 409);
  }

  await addHistory(
    db,
    current.id,
    "daily",
    reward,
    `جایزه روزانه (روز ${dayNumber})`
  );

  const updated = await getUser(db, current.id);

  return json({
    ok: true,
    message: `🎉 جایزه روز ${dayNumber} ثبت شد: +${toNot(reward)} NOT`,
    reward: toNot(reward),
    claimedDays: dayNumber,
    canClaim: false,
    balance: toNot(updated.balance),
    balanceUnits: Number(updated.balance || 0)
  });
}

// ===================== تسک‌های کانال =====================

async function isChannelMember(env, chat, userId) {
  const url =
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember` +
    `?chat_id=${encodeURIComponent(chat)}&user_id=${encodeURIComponent(userId)}`;

  let data;

  try {
    const response = await fetch(url);
    data = await response.json();
  } catch (error) {
    console.error("getChatMember failed:", error?.message || error);
    const err = new Error("بررسی عضویت فعلاً ممکن نیست. کمی بعد دوباره تلاش کن.");
    err.status = 502;
    throw err;
  }

  if (!data?.ok) {
    console.error("getChatMember error:", JSON.stringify(data));
    const err = new Error("بررسی عضویت ممکن نیست. با پشتیبانی تماس بگیر.");
    err.status = 502;
    throw err;
  }

  const member = data.result || {};
  const status = member.status;

  return (
    status === "creator" ||
    status === "administrator" ||
    status === "member" ||
    (status === "restricted" && member.is_member === true)
  );
}

function parseSqliteTime(value) {
  if (!value) return 0;
  const t = Date.parse(String(value).replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

async function handleTasksList(db, user) {
  const rows = await db.prepare(
    "SELECT task_id, created_at FROM task_claims WHERE user_id = ? ORDER BY id DESC"
  ).bind(user.id).all();

  const latestByTask = {};
  for (const row of rows.results || []) {
    const id = String(row.task_id);
    if (!latestByTask[id]) latestByTask[id] = row.created_at;
  }

  const now = Date.now();
  const tasks = Object.entries(TASKS).map(([id, task]) => {
    const lastAt = parseSqliteTime(latestByTask[id]);
    const remainingMs = lastAt ? Math.max(0, TASK_COOLDOWN_MS - (now - lastAt)) : 0;
    const onCooldown = remainingMs > 0;
    return {
      id,
      title: task.title,
      reward: toNot(task.reward),
      canClaim: !onCooldown,
      onCooldown,
      remainingMs,
      remainingHours: Math.ceil(remainingMs / 3600000)
    };
  });

  // completed = تسک‌هایی که الان در کول‌داون‌اند (امروز گرفته شده)
  const completed = tasks.filter(t => t.onCooldown).map(t => t.id);

  return json({ ok: true, completed, tasks, cooldownHours: 24 });
}

async function handleTaskClaim(db, env, user, body) {
  const taskId = String(body.taskId || "");
  const task = Object.prototype.hasOwnProperty.call(TASKS, taskId)
    ? TASKS[taskId]
    : null;

  if (!task) {
    return json({ ok: false, error: "تسک نامعتبر است." }, 400);
  }

  const last = await db.prepare(
    "SELECT id, created_at FROM task_claims WHERE user_id = ? AND task_id = ? ORDER BY id DESC LIMIT 1"
  ).bind(user.id, taskId).first();

  if (last) {
    const lastAt = parseSqliteTime(last.created_at);
    const remainingMs = Math.max(0, TASK_COOLDOWN_MS - (Date.now() - lastAt));
    if (remainingMs > 0) {
      const hours = Math.ceil(remainingMs / 3600000);
      return json({
        ok: false,
        error: `پاداش این کانال را تازه گرفته‌ای. حدود ${hours} ساعت دیگر دوباره می‌توانی بگیری.`,
        remainingMs,
        remainingHours: hours
      }, 409);
    }
  }

  const member = await isChannelMember(env, task.chat, user.id);

  if (!member) {
    return json({
      ok: false,
      error: "هنوز عضو کانال نیستی. اول عضو شو و بعد دکمه بررسی را بزن."
    }, 400);
  }

  // رکورد قبلی را برمی‌داریم تا UNIQUE(user_id, task_id) اجازهٔ ثبت مجدد بدهد
  if (last) {
    await db.prepare(
      "DELETE FROM task_claims WHERE user_id = ? AND task_id = ?"
    ).bind(user.id, taskId).run();
  }

  const inserted = await db.prepare(`
    INSERT INTO task_claims (user_id, task_id, reward_units)
    VALUES (?, ?, ?)
  `).bind(user.id, taskId, task.reward).run();

  if (Number(inserted.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "ثبت پاداش ناموفق بود. دوباره تلاش کن." }, 500);
  }

  await db.prepare(
    "UPDATE users SET balance = balance + ? WHERE id = ?"
  ).bind(task.reward, user.id).run();

  await addHistory(db, user.id, "task", task.reward, `پاداش تسک (۲۴ساعته): ${task.title}`);

  const updated = await getUser(db, user.id);

  return json({
    ok: true,
    message: `🎉 پاداش کانال ثبت شد: +${toNot(task.reward)} NOT — ۲۴ ساعت دیگر دوباره می‌توانی بگیری.`,
    reward: toNot(task.reward),
    balance: toNot(updated.balance),
    balanceUnits: Number(updated.balance || 0),
    nextClaimInMs: TASK_COOLDOWN_MS
  });
}

// ===================== postback Monetag =====================

async function handlePostback(url, env) {
  if (!env.MONETAG_POSTBACK_SECRET) {
    return json({ ok: false, error: "تنظیمات پاداش تبلیغ ناقص است." }, 500);
  }

  const secret = url.searchParams.get("secret") || "";
  if (!equalSafe(secret, env.MONETAG_POSTBACK_SECRET)) {
    return json({ ok: false, error: "اعتبار postback نامعتبر است." }, 403);
  }

  const logParams = new URLSearchParams(url.search);
  logParams.delete("secret");
  console.log("Monetag postback:", logParams.toString());

  const rewardType = url.searchParams.get("reward_event_type");
  if (rewardType && rewardType !== "valued") {
    return json({ ok: true, ignored: true, reason: "not_valued" });
  }

  const eventType = url.searchParams.get("event_type");
  if (eventType && eventType !== "impression") {
    return json({ ok: true, ignored: true, reason: "not_impression" });
  }

  const eventId = String(
    url.searchParams.get("ymid") ||
    url.searchParams.get("event_id") ||
    url.searchParams.get("transaction_id") ||
    url.searchParams.get("click_id") ||
    ""
  );

  const ymidMatch = eventId.match(/^tg(\d+)_/);

  const userCandidates = [
    url.searchParams.get("user_id"),
    url.searchParams.get("uid"),
    url.searchParams.get("telegram_id"),
    url.searchParams.get("request_var"),
    ymidMatch ? ymidMatch[1] : ""
  ];

  const userId = String(
    userCandidates.find(v => /^\d+$/.test(String(v || ""))) || ""
  );

  if (!/^\d+$/.test(userId) || !eventId || eventId.length > 200) {
    return json({ ok: false, error: "شناسه رویداد معتبر نیست." }, 400);
  }

  await ensureSchema(env.DB);

  const user = await getUser(env.DB, userId);
  if (!user) return json({ ok: false, error: "کاربر پیدا نشد." }, 404);

  try {
    await env.DB.prepare(`
      INSERT INTO ad_events (user_id, event_id, reward_units)
      VALUES (?, ?, ?)
    `).bind(userId, eventId, MONETAG_REWARD).run();
  } catch {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM ad_events WHERE event_id = ?"
    ).bind(eventId).first();

    if (duplicate) return json({ ok: true, duplicate: true });

    throw new Error("ثبت رویداد تبلیغ ناموفق بود.");
  }

  await env.DB.prepare(`
    UPDATE users SET balance = balance + ? WHERE id = ?
  `).bind(MONETAG_REWARD, userId).run();

  await addHistory(
    env.DB,
    userId,
    "monetag",
    MONETAG_REWARD,
    "پاداش تبلیغ تأییدشده"
  );

  return json({ ok: true, reward: toNot(MONETAG_REWARD) });
}

// ===================== پاداش AdsGram =====================

async function handleAdsgramReward(url, env) {
  // اگر ADSGRAM_REWARD_SECRET در Variables ست شده باشد، چک می‌شود
  const secret = url.searchParams.get("secret") || "";
  if (env.ADSGRAM_REWARD_SECRET) {
    if (!equalSafe(secret, env.ADSGRAM_REWARD_SECRET)) {
      return json({ ok: false, error: "اعتبار reward نامعتبر است." }, 403);
    }
  }

  const userId = String(
    url.searchParams.get("userid") ||
    url.searchParams.get("userId") ||
    url.searchParams.get("user_id") ||
    ""
  );

  if (!/^\d+$/.test(userId)) {
    return json({ ok: false, error: "شناسه کاربر معتبر نیست." }, 400);
  }

  await ensureSchema(env.DB);

  const user = await getUser(env.DB, userId);
  if (!user) {
    return json({ ok: false, error: "کاربر پیدا نشد." }, 404);
  }

  const eventId = String(
    url.searchParams.get("event_id") ||
    url.searchParams.get("click_id") ||
    `adsgram_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  ).slice(0, 200);

  try {
    await env.DB.prepare(`
      INSERT INTO ad_events (user_id, event_id, reward_units)
      VALUES (?, ?, ?)
    `).bind(userId, eventId, MONETAG_REWARD).run();
  } catch {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM ad_events WHERE event_id = ?"
    ).bind(eventId).first();

    if (duplicate) return json({ ok: true, duplicate: true });
    throw new Error("ثبت رویداد تبلیغ ناموفق بود.");
  }

  await env.DB.prepare(`
    UPDATE users SET balance = balance + ? WHERE id = ?
  `).bind(MONETAG_REWARD, userId).run();

  await addHistory(
    env.DB,
    userId,
    "monetag",
    MONETAG_REWARD,
    "پاداش تبلیغ AdsGram"
  );

  return json({ ok: true, reward: toNot(MONETAG_REWARD) });
}

// ===================== پنل مدیریت =====================

const WITHDRAWAL_STATUSES = ["pending", "approved", "paid", "rejected"];

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, ch => "\\" + ch);
}

function apiError(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function notifyUser(env, userId, text) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: String(userId), text })
      }
    );
    return response.ok;
  } catch (error) {
    console.error("notifyUser failed:", error?.message || error);
    return false;
  }
}

function mapWithdrawal(row) {
  const feeUnits = Number(row.fee_units || 0);
  const amountUnits = Number(row.amount_units || 0);

  return {
    id: row.id,
    user_id: String(row.user_id),
    amount: toNot(amountUnits),
    fee: toNot(feeUnits),
    net: toNot(Math.max(0, amountUnits - feeUnits)),
    wallet_address: row.wallet_address,
    status: row.status,
    created_at: row.created_at,
    processed_at: row.processed_at || null,
    admin_note: row.admin_note || "",
    tx_hash: row.tx_hash || "",
    first_name: row.first_name || "",
    username: row.username || null,
    balance: toNot(row.balance),
    user_created: row.user_created || null,
    referrals: Number(row.referrals || 0),
    paid_count: Number(row.paid_count || 0),
    wallet_users: Number(row.wallet_users || 1)
  };
}

async function handleAdmin(path, body, env) {
  const db = env.DB;

  if (path === "/api/admin/stats") {
    const results = await db.batch([
      db.prepare("SELECT COUNT(*) AS c FROM users"),
      db.prepare("SELECT COUNT(*) AS c FROM users WHERE date(created_at) = date('now')"),
      db.prepare("SELECT COALESCE(SUM(balance), 0) AS s FROM users"),
      db.prepare(`
        SELECT status, COUNT(*) AS c, COALESCE(SUM(amount_units), 0) AS s
        FROM withdrawals GROUP BY status
      `),
      db.prepare("SELECT COUNT(*) AS c FROM referrals"),
      db.prepare(`
        SELECT COUNT(*) AS c, COALESCE(SUM(reward_units), 0) AS s FROM ad_events
      `)
    ]);

    const withdrawals = {};
    for (const status of WITHDRAWAL_STATUSES) {
      withdrawals[status] = { count: 0, amount: 0 };
    }
    for (const row of results[3].results || []) {
      if (withdrawals[row.status]) {
        withdrawals[row.status] = {
          count: Number(row.c || 0),
          amount: toNot(row.s)
        };
      }
    }

    return json({
      ok: true,
      stats: {
        users: Number(results[0].results?.[0]?.c || 0),
        newToday: Number(results[1].results?.[0]?.c || 0),
        totalBalance: toNot(results[2].results?.[0]?.s),
        referrals: Number(results[4].results?.[0]?.c || 0),
        ads: {
          count: Number(results[5].results?.[0]?.c || 0),
          total: toNot(results[5].results?.[0]?.s)
        },
        withdrawals
      }
    });
  }

  if (path === "/api/admin/withdrawals") {
    const status = WITHDRAWAL_STATUSES.includes(body.status) ? body.status : "all";
    const search = String(body.search || "").trim().slice(0, 100);
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
    const offset = Math.max(0, Number(body.offset) || 0);

    const where = [];
    const binds = [];

    if (status !== "all") {
      where.push("w.status = ?");
      binds.push(status);
    }

    if (search) {
      const q = search.replace(/^@/, "");
      const like = `%${likeEscape(q)}%`;
      where.push(`(
        w.user_id = ?
        OR CAST(w.id AS TEXT) = ?
        OR w.wallet_address LIKE ? ESCAPE '\\'
        OR u.username LIKE ? ESCAPE '\\'
        OR u.first_name LIKE ? ESCAPE '\\'
      )`);
      binds.push(q, q, like, like, like);
    }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const order = status === "pending" ? "w.id ASC" : "w.id DESC";

    const rows = await db.prepare(`
      SELECT
        w.id, w.user_id, w.amount_units, w.fee_units, w.wallet_address, w.status,
        w.created_at, w.processed_at, w.admin_note, w.tx_hash,
        u.first_name, u.username, u.balance, u.created_at AS user_created,
        (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id = w.user_id) AS referrals,
        (SELECT COUNT(*) FROM withdrawals x
           WHERE x.user_id = w.user_id AND x.status = 'paid') AS paid_count,
        (SELECT COUNT(DISTINCT x.user_id) FROM withdrawals x
           WHERE x.wallet_address = w.wallet_address) AS wallet_users
      FROM withdrawals w
      LEFT JOIN users u ON u.id = w.user_id
      ${whereSql}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).bind(...binds, limit + 1, offset).all();

    const all = rows.results || [];

    return json({
      ok: true,
      items: all.slice(0, limit).map(mapWithdrawal),
      hasMore: all.length > limit
    });
  }

  if (path === "/api/admin/withdrawal/update") {
    const id = Number(body.id);
    const action = String(body.action || "");
    const note = String(body.note || "").trim().slice(0, 300);
    const txHash = String(body.txHash || "").trim().slice(0, 200);
    const notify = body.notify !== false;

    if (!Number.isInteger(id) || id <= 0) {
      return apiError("شناسه درخواست نامعتبر است.");
    }

    const withdrawal = await db.prepare(
      "SELECT * FROM withdrawals WHERE id = ?"
    ).bind(id).first();

    if (!withdrawal) return apiError("درخواست پیدا نشد.", 404);

    let newStatus;
    let allowedFrom;

    if (action === "approve") {
      newStatus = "approved";
      allowedFrom = ["pending"];
    } else if (action === "pay") {
      newStatus = "paid";
      allowedFrom = ["pending", "approved"];
    } else if (action === "reject") {
      newStatus = "rejected";
      allowedFrom = ["pending", "approved"];
      if (!note) return apiError("دلیل رد درخواست را بنویس.");
    } else {
      return apiError("عملیات نامعتبر است.");
    }

    if (!allowedFrom.includes(withdrawal.status)) {
      return apiError("وضعیت فعلی درخواست اجازه‌ی این تغییر را نمی‌دهد.", 409);
    }

    const placeholders = allowedFrom.map(() => "?").join(",");

    const update = await db.prepare(`
      UPDATE withdrawals
      SET status = ?,
          processed_at = CURRENT_TIMESTAMP,
          admin_note = CASE WHEN ? != '' THEN ? ELSE admin_note END,
          tx_hash = CASE WHEN ? != '' THEN ? ELSE tx_hash END
      WHERE id = ? AND status IN (${placeholders})
    `).bind(newStatus, note, note, txHash, txHash, id, ...allowedFrom).run();

    if (Number(update.meta?.changes || 0) !== 1) {
      return apiError("این درخواست هم‌زمان تغییر کرده است. صفحه را به‌روزرسانی کن.", 409);
    }

    if (newStatus === "rejected") {
      await db.batch([
        db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?")
          .bind(withdrawal.amount_units, withdrawal.user_id),
        db.prepare(`
          INSERT INTO history (user_id, kind, amount_units, details)
          VALUES (?, 'refund', ?, ?)
        `).bind(
          withdrawal.user_id,
          withdrawal.amount_units,
          `بازگشت مبلغ برداشت شماره ${id}`
        )
      ]);
    }

    let notified = false;

    if (notify) {
      const amountText = toNot(withdrawal.amount_units);
      const feeUnits = Number(withdrawal.fee_units || 0);
      const netText = toNot(Math.max(0, Number(withdrawal.amount_units || 0) - feeUnits));
      const feeNote = feeUnits > 0
        ? ` (پس از کسر کارمزد شبکه ${toNot(feeUnits)} NOT، مبلغ دریافتی: ${netText} NOT)`
        : "";
      let text = "";

      if (newStatus === "approved") {
        text = `✅ درخواست برداشت شماره ${id} به مبلغ ${amountText} NOT${feeNote} تأیید شد و در صف پرداخت است.`;
      } else if (newStatus === "paid") {
        text = `💸 درخواست برداشت شماره ${id} به مبلغ ${amountText} NOT${feeNote} پرداخت شد.`;
        if (txHash) text += `\nکد تراکنش: ${txHash}`;
      } else {
        text = `❌ درخواست برداشت شماره ${id} رد شد و ${amountText} NOT به موجودی‌ات برگشت.\nدلیل: ${note}`;
      }

      notified = await notifyUser(env, withdrawal.user_id, text);
    }

    return json({
      ok: true,
      id,
      status: newStatus,
      admin_note: note || withdrawal.admin_note || "",
      tx_hash: txHash || withdrawal.tx_hash || "",
      notified
    });
  }

  if (path === "/api/admin/users") {
    const search = String(body.search || "").trim().slice(0, 100);
    const sort = body.sort === "balance" ? "balance" : "new";
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
    const offset = Math.max(0, Number(body.offset) || 0);

    const binds = [];
    let whereSql = "";

    if (search) {
      const q = search.replace(/^@/, "");
      const like = `%${likeEscape(q)}%`;
      whereSql = `WHERE (
        u.id = ?
        OR u.username LIKE ? ESCAPE '\\'
        OR u.first_name LIKE ? ESCAPE '\\'
      )`;
      binds.push(q, like, like);
    }

    const order = sort === "balance"
      ? "u.balance DESC, u.id"
      : "u.created_at DESC, u.id DESC";

    const rows = await db.prepare(`
      SELECT
        u.id, u.first_name, u.username, u.balance, u.created_at, u.referred_by,
        (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id = u.id) AS referrals,
        (SELECT COUNT(*) FROM withdrawals w WHERE w.user_id = u.id) AS withdrawals_count
      FROM users u
      ${whereSql}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).bind(...binds, limit + 1, offset).all();

    const all = rows.results || [];

    return json({
      ok: true,
      items: all.slice(0, limit).map(row => ({
        id: String(row.id),
        first_name: row.first_name || "",
        username: row.username || null,
        balance: toNot(row.balance),
        created_at: row.created_at || null,
        referred_by: row.referred_by || null,
        referrals: Number(row.referrals || 0),
        withdrawals_count: Number(row.withdrawals_count || 0)
      })),
      hasMore: all.length > limit
    });
  }

  if (path === "/api/admin/user/detail") {
    const userId = String(body.userId || "");
    if (!/^\d+$/.test(userId)) return apiError("شناسه کاربر نامعتبر است.");

    const target = await getUser(db, userId);
    if (!target) return apiError("کاربر پیدا نشد.", 404);

    const results = await db.batch([
      db.prepare("SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ?").bind(userId),
      db.prepare(`
        SELECT id, kind, amount_units, details, created_at
        FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 30
      `).bind(userId),
      db.prepare(`
        SELECT id, amount_units, fee_units, wallet_address, status, created_at
        FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 10
      `).bind(userId),
      db.prepare("SELECT COUNT(*) AS c FROM ad_events WHERE user_id = ?").bind(userId)
    ]);

    return json({
      ok: true,
      user: {
        id: String(target.id),
        first_name: target.first_name || "",
        username: target.username || null,
        balance: toNot(target.balance),
        created_at: target.created_at || null,
        referred_by: target.referred_by || null
      },
      referrals: Number(results[0].results?.[0]?.c || 0),
      adsWatched: Number(results[3].results?.[0]?.c || 0),
      history: (results[1].results || []).map(item => ({
        id: item.id,
        kind: item.kind,
        amount: toNot(item.amount_units),
        details: item.details || "",
        created_at: item.created_at
      })),
      withdrawals: (results[2].results || []).map(item => ({
        id: item.id,
        amount: toNot(item.amount_units),
        fee: toNot(item.fee_units),
        net: toNot(Math.max(0, Number(item.amount_units || 0) - Number(item.fee_units || 0))),
        wallet_address: item.wallet_address,
        status: item.status,
        created_at: item.created_at
      }))
    });
  }

  if (path === "/api/admin/user/adjust") {
    const targetId = String(body.userId || "");
    const amount = Number(body.amount);
    const note = String(body.note || "").trim().slice(0, 200);

    if (!/^\d+$/.test(targetId)) return apiError("شناسه کاربر نامعتبر است.");

    if (
      !Number.isFinite(amount) ||
      amount === 0 ||
      Math.abs(amount) > 100000 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
    ) {
      return apiError("مبلغ نامعتبر است (حداکثر دو رقم اعشار).");
    }

    if (!note) return apiError("دلیل تغییر موجودی را بنویس.");

    const target = await getUser(db, targetId);
    if (!target) return apiError("کاربر پیدا نشد.", 404);

    const units = Math.round(amount * 100);

    const result = await db.prepare(`
      UPDATE users SET balance = balance + ?
      WHERE id = ? AND balance + ? >= 0
    `).bind(units, targetId, units).run();

    if (Number(result.meta?.changes || 0) !== 1) {
      return apiError("موجودی کاربر برای این کسر کافی نیست.");
    }

    await addHistory(db, targetId, "admin", units, note);

    const updated = await getUser(db, targetId);

    return json({
      ok: true,
      balance: toNot(updated.balance)
    });
  }

  return apiError("مسیر مدیریت پیدا نشد.", 404);
}

async function route(request, env) {
  if (!cors(request)) {
    return json({ ok: false, error: "Origin مجاز نیست." }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && (path === "/" || path === "/health")) {
    return json({ ok: true, service: "not-reward-api" });
  }

  // postback Monetag
  if (request.method === "GET" && path === "/api/monetag/postback") {
    try {
      if (!env.DB) throw new Error("اتصال D1 با نام DB تنظیم نشده است.");
      return await handlePostback(url, env);
    } catch (error) {
      console.error("Postback error:", error?.message || error);
      return json({ ok: false, error: "خطای داخلی postback." }, 500);
    }
  }

  // واریزی‌های اخیر عمومی (برای اثبات پرداخت — بدون داده حساس کامل)
  if (request.method === "GET" && path === "/api/payouts/recent") {
    try {
      if (!env.DB) throw new Error("اتصال D1 با نام DB تنظیم نشده است.");
      await ensureSchema(env.DB);
      const rows = await env.DB.prepare(`
        SELECT amount_units, fee_units, wallet_address, created_at, processed_at, tx_hash
        FROM withdrawals
        WHERE status = 'paid'
        ORDER BY COALESCE(processed_at, created_at) DESC
        LIMIT 20
      `).all();

      const items = (rows.results || []).map(row => {
        const wallet = String(row.wallet_address || "");
        const short = wallet.length > 12
          ? wallet.slice(0, 6) + "…" + wallet.slice(-4)
          : wallet;
        return {
          amount: toNot(row.amount_units),
          fee: toNot(row.fee_units),
          net: toNot(Math.max(0, Number(row.amount_units || 0) - Number(row.fee_units || 0))),
          wallet: short,
          date: row.processed_at || row.created_at || "",
          tx_hash: row.tx_hash || ""
        };
      });

      return json({ ok: true, items });
    } catch (error) {
      console.error("Recent payouts error:", error?.message || error);
      return json({ ok: false, error: "خطا در دریافت واریزی‌ها." }, 500);
    }
  }

  // پاداش AdsGram (Reward URL)
  if (request.method === "GET" && path === "/api/adsgram/reward") {
    try {
      if (!env.DB) throw new Error("اتصال D1 با نام DB تنظیم نشده است.");
      return await handleAdsgramReward(url, env);
    } catch (error) {
      console.error("AdsGram reward error:", error?.message || error);
      return json({ ok: false, error: "خطای داخلی reward." }, 500);
    }
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "روش درخواست پشتیبانی نمی‌شود." }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "بدنهٔ JSON معتبر نیست." }, 400);
  }

  try {
    if (!env.DB) throw new Error("اتصال D1 با نام DB تنظیم نشده است.");
    if (!env.BOT_TOKEN) throw new Error("متغیر محرمانه BOT_TOKEN تنظیم نشده است.");

    await ensureSchema(env.DB);
    const user = await requireUser(request, body, env);

    const startParam = user.start_param || body.startParam || "";
    await createUser(env.DB, user, startParam);
    const current = await getUser(env.DB, user.id);

    if (path.startsWith("/api/admin/")) {
      if (String(user.id) !== String(ADMIN_ID)) {
        return json({ ok: false, error: "دسترسی مدیر ندارید." }, 403);
      }
      return await handleAdmin(path, body, env);
    }

    if (path === "/api/me") {
      const adsWatched = await getAdsWatched(env.DB, user.id);

      return json({
        ok: true,
        user: publicUser(current),
        isAdmin: String(user.id) === String(ADMIN_ID),
        balance: toNot(current.balance),
        balanceUnits: Number(current.balance || 0),
        adsWatched,
        minAds: MIN_ADS_FOR_WITHDRAWAL,
        minWithdrawal: toNot(MIN_WITHDRAWAL),
        networkFee: toNot(NETWORK_FEE)
      });
    }

    if (path === "/api/referrals") {
      const row = await env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM referrals
        WHERE inviter_id = ?
      `).bind(user.id).first();

      const count = Number(row?.count || 0);

      return json({
        ok: true,
        count,
        referralCount: count,
        referralReward: toNot(REFERRAL_REWARD),
        referralLink: buildReferralLink(user.id),
        balance: toNot(current.balance)
      });
    }

    if (path === "/api/history") {
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));

      const history = await env.DB.prepare(`
        SELECT id, kind, amount_units, details, created_at
        FROM history
        WHERE user_id = ? AND kind NOT IN ('withdraw', 'withdrawal')
        ORDER BY id DESC
        LIMIT ?
      `).bind(user.id, limit).all();

      const withdrawals = await env.DB.prepare(`
        SELECT id, amount_units, wallet_address, status, created_at
        FROM withdrawals
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).bind(user.id, limit).all();

      return json({
        ok: true,
        history: (history.results || []).map(item => ({
          ...item,
          amount: toNot(item.amount_units)
        })),
        withdrawals: (withdrawals.results || []).map(item => ({
          id: item.id,
          status: item.status,
          created_at: item.created_at,
          amount_units: item.amount_units,
          amount: toNot(item.amount_units)
        }))
      });
    }

    if (path === "/api/tap") {
      const today = todayUTC();
      let count = Number(current.tap_count || 0);

      if (current.tap_date !== today) count = 0;

      if (count >= DAILY_TAP_LIMIT) {
        return json({ ok: false, error: "سقف روزانه کلیک‌ها تمام شده است." }, 429);
      }

      await env.DB.prepare(`
        UPDATE users
        SET balance = balance + ?, tap_count = ?, tap_date = ?
        WHERE id = ?
      `).bind(TAP_REWARD, count + 1, today, user.id).run();

      await addHistory(env.DB, user.id, "tap", TAP_REWARD, "پاداش کلیک");

      const updated = await getUser(env.DB, user.id);

      return json({
        ok: true,
        reward: toNot(TAP_REWARD),
        balance: toNot(updated.balance),
        balanceUnits: Number(updated.balance || 0),
        tapsToday: count + 1,
        dailyLimit: DAILY_TAP_LIMIT
      });
    }

    if (path === "/api/daily/status") {
      return await handleDailyStatus(current);
    }

    if (path === "/api/daily/claim") {
      return await handleDailyClaim(env.DB, current);
    }

    if (path === "/api/tasks") {
      return await handleTasksList(env.DB, user);
    }

    if (path === "/api/tasks/claim") {
      return await handleTaskClaim(env.DB, env, user, body);
    }

    if (path === "/api/withdraw") {
      const amount = Number(body.amount);
      const wallet = String(body.walletAddress || body.wallet_address || "").trim();

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
      ) {
        return json({ ok: false, error: "مبلغ برداشت نامعتبر است." }, 400);
      }

      const units = Math.round(amount * 100);

      if (units < MIN_WITHDRAWAL) {
        return json({
          ok: false,
          error: `حداقل برداشت ${MIN_WITHDRAWAL / 100} NOT است.`
        }, 400);
      }

      if (wallet.length < 20 || wallet.length > 150) {
        return json({ ok: false, error: "آدرس کیف پول معتبر نیست." }, 400);
      }

      // تبلیغ برای برداشت الزامی نیست (سیاست شبکه‌های تبلیغاتی)

      const deduction = await env.DB.prepare(`
        UPDATE users SET balance = balance - ?
        WHERE id = ? AND balance >= ?
      `).bind(units, user.id, units).run();

      if (Number(deduction.meta?.changes || 0) !== 1) {
        return json({ ok: false, error: "موجودی برای این برداشت کافی نیست." }, 400);
      }

      const result = await env.DB.prepare(`
        INSERT INTO withdrawals (user_id, amount_units, fee_units, wallet_address, status)
        VALUES (?, ?, ?, ?, 'pending')
      `).bind(user.id, units, NETWORK_FEE, wallet).run();

      const netUnits = units - NETWORK_FEE;

      await addHistory(
        env.DB,
        user.id,
        "withdrawal",
        -units,
        `درخواست برداشت ${amount} NOT (کارمزد شبکه ${toNot(NETWORK_FEE)} NOT، دریافتی ${toNot(netUnits)} NOT)`
      );

      const updated = await getUser(env.DB, user.id);

      return json({
        ok: true,
        message: `درخواست برداشت ثبت شد. پس از کسر کارمزد شبکه (${toNot(NETWORK_FEE)} NOT)، مبلغ ${toNot(netUnits)} NOT برایت ارسال می‌شود.`,
        withdrawalId: result.meta?.last_row_id || null,
        fee: toNot(NETWORK_FEE),
        net: toNot(netUnits),
        balance: toNot(updated.balance),
        balanceUnits: Number(updated.balance || 0)
      });
    }

    return json({ ok: false, error: "مسیر API پیدا نشد." }, 404);
  } catch (error) {
    console.error("Worker error:", error?.stack || error);

    const status = error?.status || 500;
    const friendly = status === 401 || status === 502;

    return json({
      ok: false,
      error: friendly
        ? error.message
        : "خطای سرور یا ساختار دیتابیس. تنظیمات Worker و D1 را بررسی کن."
    }, status);
  }
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Fatal error:", error?.stack || error);
      return json({ ok: false, error: "خطای داخلی سرور." }, 500);
    }
  }
};
