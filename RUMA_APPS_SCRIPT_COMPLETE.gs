/**
 * RUMA - Google Apps Script Backend Engine
 */

const DB_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  return HtmlService.createHtmlOutput("RUMA API Engine Running.");
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply(false, "Invalid JSON payload", "BAD_REQUEST");
  }

  const action = req.action;
  const token = req.token || "";

  try {
    // Public Endpoints
    if (action === "login") return reply(true, "", null, doLogin(req));
    if (action === "register") return reply(true, "", null, doRegister(req));
    if (action === "feed") return reply(true, "", null, getFeed(req, token));
    if (action === "trends") return reply(true, "", null, getTrends());
    if (action === "people") return reply(true, "", null, getPeople(req, token));
    if (action === "profile") return reply(true, "", null, getProfile(req, token));
    if (action === "comments") return reply(true, "", null, getComments(req));
    if (action === "rooms") return reply(true, "", null, getRooms(req, token));
    if (action === "room") return reply(true, "", null, getRoomDetail(req, token));
    if (action === "reels") return reply(true, "", null, getReels(req, token));

    // Authenticated Endpoints
    const user = getUserByToken(token);
    if (!user) return reply(false, "Sesi telah berakhir. Silakan login kembali.", "UNAUTH");
    if (action === "notifications") return reply(true, "", null, getNotifications(user));
    if (action === "markNotificationsRead") return reply(true, "", null, markNotificationsRead(user));
    if (action === "uploadMedia") return reply(true, "", null, uploadMedia(req, user));
    if (action === "reportPost") return reply(true, "", null, reportPost(req, user));
    if (["adminOverview", "adminUsers", "adminPosts", "adminReports", "adminUpdateUser", "adminDeletePost", "adminResolveReport"].indexOf(action) >= 0) {
      return reply(true, "", null, adminAction(action, req, user));
    }

    if (action === "me") return reply(true, "", null, sanitizeUser(user));
    if (action === "createPost") return reply(true, "", null, createPost(req, user));
    if (action === "deletePost") return reply(true, "", null, deletePost(req, user));
    if (action === "toggleLike") return reply(true, "", null, toggleLike(req, user));
    if (action === "toggleRepost") return reply(true, "", null, toggleRepost(req, user));
    if (action === "toggleSave") return reply(true, "", null, toggleSave(req, user));
    if (action === "addComment") return reply(true, "", null, addComment(req, user));
    if (action === "toggleFollow") return reply(true, "", null, toggleFollow(req, user));
    if (action === "updateProfile") return reply(true, "", null, updateProfile(req, user));
    if (action === "createRoom") return reply(true, "", null, createRoom(req, user));
    if (action === "joinRoom") return reply(true, "", null, joinRoom(req, user));
    if (action === "leaveRoom") return reply(true, "", null, leaveRoom(req, user));
    if (action === "createRoomPost") return reply(true, "", null, createRoomPost(req, user));
    if (action === "likeRoomPost") return reply(true, "", null, likeRoomPost(req, user));
    if (action === "toggleReelLike") return reply(true, "", null, toggleReelLike(req, user));
    if (action === "toggleReelSave") return reply(true, "", null, toggleReelSave(req, user));
    if (action === "sendGift") return reply(true, "", null, sendGift(req, user));
    if (action === "creator") return reply(true, "", null, getCreatorData(user));

    return reply(false, "Action tidak ditemukan: " + action, "NOT_FOUND");
  } catch (err) {
    return reply(false, err.message || "Terjadi kesalahan sistem", "SERVER_ERROR");
  }
}

function reply(ok, message, code, data) {
  const out = { ok: ok };
  if (message) out.message = message;
  if (code) out.code = code;
  if (data) out.data = data;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= HELPER SPREADSHEET ================= */
function getSheet(name) {
  const ss = SpreadsheetApp.openById(DB_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initSheetHeader(sheet, name);
  }
  ensureColumns(sheet, name);
  return sheet;
}

function ensureColumns(sheet, name) {
  const expected = {
    Users: ["role", "status", "avatarUrl", "bannerUrl", "verified"],
    Posts: ["mediaUrl", "mediaType", "mediaName"],
    Comments: ["handle"],
    Reels: ["mediaUrl", "mediaType"],
    Reports: ["id", "postId", "reporterUserId", "reporterHandle", "reason", "status", "createdAt", "resolvedAt"],
    Notifications: ["id", "userId", "type", "actorUserId", "actorName", "actorHandle", "entityId", "message", "read", "createdAt"]
  }[name] || [];
  if (!expected.length) return;
  const last = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, last).getValues()[0].map(String);
  expected.forEach(header => {
    if (headers.indexOf(header) < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      headers.push(header);
    }
  });
}

function initSheetHeader(sheet, name) {
  const headers = {
    Users: ["id", "username", "password", "name", "token", "bio", "color", "ink", "coins", "createdAt", "role", "status", "avatarUrl", "bannerUrl", "verified"],
    Posts: ["id", "userId", "name", "handle", "initial", "color", "ink", "topic", "text", "createdAt", "mediaUrl", "mediaType", "mediaName"],
    Comments: ["id", "postId", "userId", "name", "text", "createdAt", "handle"],
    Likes: ["postId", "userId"],
    Saves: ["postId", "userId"],
    Reposts: ["postId", "userId"],
    Followers: ["followerHandle", "targetHandle"],
    Rooms: ["id", "name", "description", "category", "emoji", "access", "password", "ownerHandle", "membersCount", "createdAt"],
    RoomMembers: ["roomId", "userId"],
    RoomPosts: ["id", "roomId", "userId", "name", "handle", "text", "likes", "createdAt"],
    Reels: ["id", "user", "handle", "initial", "emoji", "caption", "audio", "createdAt", "mediaUrl", "mediaType"],
    ReelLikes: ["reelId", "userId"],
    ReelSaves: ["reelId", "userId"],
    Gifts: ["id", "reelId", "senderUserId", "giftName", "coins", "createdAt"],
    Reports: ["id", "postId", "reporterUserId", "reporterHandle", "reason", "status", "createdAt", "resolvedAt"],
    Notifications: ["id", "userId", "type", "actorUserId", "actorName", "actorHandle", "entityId", "message", "read", "createdAt"]
  };
  if (headers[name]) {
    sheet.appendRow(headers[name]);
  }
}

function getRows(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function getUserByToken(token) {
  if (!token) return null;
  const users = getRows("Users");
  return users.find(u => String(u.token) === String(token)) || null;
}

function getUserByUsername(username) {
  const normalized = String(username || "").toLowerCase().trim().replace(/^@/, "");
  return getRows("Users").find(u => String(u.username).toLowerCase() === normalized) || null;
}

function setupAdminAccount() {
  const sheet = getSheet("Users");
  const existing = getUserByUsername("roby");
  if (existing) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(existing.id)) {
        sheet.getRange(i + 1, 3).setValue("tauhid12");
        sheet.getRange(i + 1, 4).setValue("Roby");
        sheet.getRange(i + 1, 11).setValue("admin");
        sheet.getRange(i + 1, 12).setValue("active");
        sheet.getRange(i + 1, 15).setValue(true);
        return "Admin roby diperbarui.";
      }
    }
  }
  sheet.appendRow(["U_" + Utilities.getUuid(), "roby", "tauhid12", "Roby", "", "Administrator RUMA", "#e8efff", "#2859a8", 1250, Date.now(), "admin", "active", "", "", true]);
  return "Admin roby berhasil dibuat.";
}

function setupRuma() {
  ["Users", "Posts", "Comments", "Likes", "Saves", "Reposts", "Followers", "Rooms", "RoomMembers", "RoomPosts", "Reels", "ReelLikes", "ReelSaves", "Gifts", "Reports", "Notifications"].forEach(getSheet);
  return setupAdminAccount();
}

function sanitizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    handle: "@" + u.username,
    name: u.name,
    initial: (u.name || u.username)[0].toUpperCase(),
    bio: u.bio || "",
    color: u.color || "#e8efff",
    ink: u.ink || "#2859a8",
    coins: Number(u.coins) || 1250,
    followers: getRows("Followers").filter(f => f.targetHandle === "@" + u.username).length,
    following: getRows("Followers").filter(f => f.followerHandle === "@" + u.username).length,
    role: u.role || "user",
    status: u.status || "active",
    avatarUrl: u.avatarUrl || "",
    bannerUrl: u.bannerUrl || "",
    verified: String(u.username).toLowerCase() === "roby" || String(u.verified).toLowerCase() === "true"
  };
}

function createNotification(userId, type, actor, entityId, message) {
  if (!userId || !actor || String(userId) === String(actor.id)) return;
  getSheet("Notifications").appendRow([
    "N_" + Utilities.getUuid(), String(userId), type, String(actor.id || ""),
    String(actor.name || actor.username || "Pengguna"), "@" + String(actor.username || "").replace(/^@/, ""),
    String(entityId || ""), message, false, Date.now()
  ]);
}

function getNotifications(user) {
  const items = getRows("Notifications").filter(n => String(n.userId) === String(user.id));
  return {
    items: items.reverse().slice(0, 100).map(n => ({
      id: String(n.id), type: String(n.type || "activity"), actorName: String(n.actorName || "Pengguna"),
      actorHandle: String(n.actorHandle || ""), entityId: String(n.entityId || ""), message: String(n.message || "Aktivitas baru di akunmu."),
      read: String(n.read).toLowerCase() === "true" || Number(n.read) === 1, createdAt: Number(n.createdAt) || Date.now()
    })),
    unread: items.filter(n => !(String(n.read).toLowerCase() === "true" || Number(n.read) === 1)).length
  };
}

function markNotificationsRead(user) {
  const sheet = getSheet("Notifications");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(user.id) && String(data[i][8]).toLowerCase() !== "true") sheet.getRange(i + 1, 9).setValue(true);
  }
  return true;
}

/* ================= AUTHENTICATION ================= */
function doLogin(req) {
  const username = (req.username || "").toLowerCase().trim().replace(/^@/, "");
  const password = req.password || "";

  const users = getRows("Users");
  const user = users.find(u => String(u.username).toLowerCase() === username && String(u.password) === password);
  
  if (!user) throw new Error("Username atau password salah.");
  if (String(user.status || "active") === "blocked") throw new Error("Akun ini diblokir.");

  const newToken = "TK_" + Utilities.getUuid();
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === username) {
      sheet.getRange(i + 1, 5).setValue(newToken);
      user.token = newToken;
      break;
    }
  }
  return { user: sanitizeUser(user), token: newToken };
}

function doRegister(req) {
  const username = (req.username || "").toLowerCase().trim().replace(/^@/, "");
  const password = req.password || "";
  const name = (req.name || username).trim();

  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new Error("Username hanya boleh mengandung huruf kecil, angka, _ (3-20 karakter).");
  }
  if (password.length < 8) {
    throw new Error("Password minimal 8 karakter.");
  }

  const sheet = getSheet("Users");
  const users = getRows("Users");
  if (users.some(u => String(u.username).toLowerCase() === username)) {
    throw new Error("Username sudah digunakan.");
  }

  const id = "U_" + Utilities.getUuid();
  const token = "TK_" + Utilities.getUuid();
  const colors = [["#e8efff","#2859a8"], ["#fbe7e5","#9e4540"], ["#e2f4e9","#237449"], ["#eee7ff","#6844aa"]];
  const palette = colors[Math.floor(Math.random() * colors.length)];

  const newUser = [
    id, username, password, name, token, 
    "Anggota RUMA yang senang berbagi cerita.", 
    palette[0], palette[1], 1250, Date.now(), "user", "active"
  ];
  sheet.appendRow(newUser);

  return {
    user: sanitizeUser({
      id, username, name, bio: newUser[5], color: palette[0], ink: palette[1], coins: 1250
    }),
    token
  };
}

/* ================= FEED & POSTS ================= */
function getFeed(req, token) {
  const user = getUserByToken(token);
  let posts = getRows("Posts");
  const likes = getRows("Likes");
  const saves = getRows("Saves");
  const reposts = getRows("Reposts");
  const comments = getRows("Comments");
  const users = getRows("Users");

  if (req.filter === "saved" && user) {
    const mySaves = new Set(saves.filter(s => String(s.userId) === String(user.id)).map(s => String(s.postId)));
    posts = posts.filter(p => mySaves.has(String(p.id)));
  } else if (req.filter === "user" && req.handle) {
    posts = posts.filter(p => String(p.handle).toLowerCase() === String(req.handle).toLowerCase());
  } else if (req.filter === "liked" && req.handle) {
    const targetUser = getRows("Users").find(u => "@" + u.username === req.handle);
    if (targetUser) {
      const likedIds = new Set(likes.filter(l => String(l.userId) === String(targetUser.id)).map(l => String(l.postId)));
      posts = posts.filter(p => likedIds.has(String(p.id)));
    }
  }

  if (req.q) {
    const q = req.q.toLowerCase();
    posts = posts.filter(p => (p.text + " " + p.name + " " + p.handle + " " + p.topic).toLowerCase().includes(q));
  } else if (req.tag) {
    const tag = "#" + req.tag.toLowerCase();
    posts = posts.filter(p => p.text.toLowerCase().includes(tag));
  }

  posts.sort((a, b) => (req.sort === "terbaru" ? b.createdAt - a.createdAt : b.id - a.id));

  const items = posts.map(p => {
    const owner = users.find(u => String(u.id) === String(p.userId));
    const pLikes = likes.filter(l => String(l.postId) === String(p.id));
    const pSaves = saves.filter(s => String(s.postId) === String(p.id));
    const pReposts = reposts.filter(r => String(r.postId) === String(p.id));
    const pCm = comments.filter(c => String(c.postId) === String(p.id));

    return {
      id: String(p.id),
      name: p.name,
      handle: p.handle,
      initial: p.initial,
      color: p.color,
      ink: p.ink,
      avatarUrl: owner ? owner.avatarUrl || "" : "",
      bannerUrl: owner ? owner.bannerUrl || "" : "",
      verified: owner ? String(owner.username).toLowerCase() === "roby" || String(owner.verified).toLowerCase() === "true" : false,
      topic: p.topic || "Diskusi",
      text: p.text,
      createdAt: Number(p.createdAt),
      likes: pLikes.length,
      liked: user ? pLikes.some(l => String(l.userId) === String(user.id)) : false,
      reposts: pReposts.length,
      reposted: user ? pReposts.some(r => String(r.userId) === String(user.id)) : false,
      saved: user ? pSaves.some(s => String(s.userId) === String(user.id)) : false,
      commentsCount: pCm.length,
      mine: user ? String(p.userId) === String(user.id) : false,
      mediaUrl: p.mediaUrl || "",
      mediaType: p.mediaType || "",
      mediaName: p.mediaName || ""
    };
  });

  return { items: items, next: null };
}

function createPost(req, user) {
  const text = (req.text || "").trim();
  if (!text) throw new Error("Teks postingan tidak boleh kosong.");

  const tags = text.match(/#([\p{L}\d_]+)/gu) || [];
  const topic = tags.length ? tags[0].slice(1) : "Diskusi Umum";

  const id = "P_" + Date.now();
  const createdAt = Date.now();
  const newRow = [
    id, user.id, user.name, "@" + user.username,
    (user.name || user.username)[0].toUpperCase(),
    user.color, user.ink, topic, text, createdAt,
    String(req.mediaUrl || ""), String(req.mediaType || ""), String(req.mediaName || "")
  ];

  getSheet("Posts").appendRow(newRow);

  return {
    id, name: user.name, handle: "@" + user.username, initial: newRow[4],
    color: user.color, ink: user.ink, topic, text, createdAt,
    mediaUrl: String(req.mediaUrl || ""), mediaType: String(req.mediaType || ""), mediaName: String(req.mediaName || ""),
    likes: 0, liked: false, reposts: 0, reposted: false, saved: false, commentsCount: 0, mine: true
  };
}

function deletePost(req, user) {
  const sheet = getSheet("Posts");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(req.id) && String(data[i][1]) === String(user.id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  throw new Error("Postingan tidak ditemukan atau tidak memiliki hak akses.");
}

function toggleLike(req, user) {
  const result = toggleRelation("Likes", "postId", req.id, user.id);
  if (result.on) {
    const post = getRows("Posts").find(p => String(p.id) === String(req.id));
    if (post) createNotification(post.userId, "like", user, req.id, user.name + " menyukai postinganmu.");
  }
  return result;
}
function toggleSave(req, user) {
  return toggleRelation("Saves", "postId", req.id, user.id);
}
function toggleRepost(req, user) {
  const result = toggleRelation("Reposts", "postId", req.id, user.id);
  if (result.on) {
    const post = getRows("Posts").find(p => String(p.id) === String(req.id));
    if (post) createNotification(post.userId, "repost", user, req.id, user.name + " merepost postinganmu.");
  }
  return result;
}

function toggleRelation(sheetName, keyField, keyVal, userId) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  let foundIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(keyVal) && String(data[i][1]) === String(userId)) {
      foundIndex = i + 1;
      break;
    }
  }

  if (foundIndex > 0) {
    sheet.deleteRow(foundIndex);
    const count = sheet.getDataRange().getValues().filter(r => String(r[0]) === String(keyVal)).length - 1;
    return { on: false, count: Math.max(0, count) };
  } else {
    sheet.appendRow([keyVal, userId]);
    const count = sheet.getDataRange().getValues().filter(r => String(r[0]) === String(keyVal)).length - 1;
    return { on: true, count: Math.max(1, count) };
  }
}

/* ================= COMMENTS ================= */
function getComments(req) {
  const comments = getRows("Comments").filter(c => String(c.postId) === String(req.postId));
  return comments.map(c => ({
    id: c.id, userId: c.userId, name: c.name, handle: c.handle || "", text: c.text, createdAt: Number(c.createdAt)
  }));
}

function addComment(req, user) {
  const text = (req.text || "").trim();
  if (!text) throw new Error("Komentar tidak boleh kosong.");

  const id = "C_" + Date.now();
  const createdAt = Date.now();
  const handle = "@" + String(user.username || "").replace(/^@/, "");
  getSheet("Comments").appendRow([id, req.postId, user.id, user.name, text, createdAt, handle]);

  const post = getRows("Posts").find(p => String(p.id) === String(req.postId));
  if (post) createNotification(post.userId, "comment", user, req.postId, user.name + " mengomentari postinganmu.");

  return { id, userId: user.id, name: user.name, handle, text, createdAt };
}

/* ================= FOLLOW ================= */
function toggleFollow(req, user) {
  const followerHandle = "@" + user.username;
  const targetHandle = req.handle;
  const sheet = getSheet("Followers");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === followerHandle && data[i][1] === targetHandle) {
      sheet.deleteRow(i + 1);
      return { on: false };
    }
  }
  sheet.appendRow([followerHandle, targetHandle]);
  const target = getRows("Users").find(u => ("@" + String(u.username)).toLowerCase() === String(targetHandle).toLowerCase());
  if (target) createNotification(target.id, "follow", user, targetHandle, user.name + " mulai mengikutimu.");
  return { on: true };
}

/* ================= PROFILE & TRENDS ================= */
function getProfile(req, token) {
  const user = getUserByToken(token);
  const targetHandle = req.handle || (user ? "@" + user.username : "");
  const allUsers = getRows("Users");
  const targetUser = allUsers.find(u => "@" + u.username.toLowerCase() === targetHandle.toLowerCase());

  if (!targetUser) throw new Error("Pengguna tidak ditemukan.");

  const followers = getRows("Followers");
  const posts = getRows("Posts").filter(p => p.handle.toLowerCase() === targetHandle.toLowerCase());

  return {
    user: sanitizeUser(targetUser),
    posts: posts.length,
    isFollowing: user ? followers.some(f => f.followerHandle === "@" + user.username && f.targetHandle.toLowerCase() === targetHandle.toLowerCase()) : false
  };
}

function updateProfile(req, user) {
  const name = (req.name || user.name).trim();
  const bio = (req.bio || "").trim();
  const avatarUrl = String(req.avatarUrl || user.avatarUrl || "");
  const bannerUrl = String(req.bannerUrl || user.bannerUrl || "");
  const username = String(req.username || user.username).toLowerCase().trim().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("Username hanya boleh 3-20 karakter: huruf kecil, angka, atau _.");
  if (getRows("Users").some(u => String(u.id) !== String(user.id) && String(u.username).toLowerCase() === username)) {
    throw new Error("Username sudah digunakan.");
  }
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id)) {
      sheet.getRange(i + 1, 4).setValue(name);
      sheet.getRange(i + 1, 2).setValue(username);
      sheet.getRange(i + 1, 6).setValue(bio);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const avatarColumn = headers.indexOf("avatarUrl") + 1;
      const bannerColumn = headers.indexOf("bannerUrl") + 1;
      if (avatarColumn > 0) sheet.getRange(i + 1, avatarColumn).setValue(avatarUrl);
      if (bannerColumn > 0) sheet.getRange(i + 1, bannerColumn).setValue(bannerUrl);
      user.name = name;
      user.username = username;
      user.bio = bio;
      user.avatarUrl = avatarUrl;
      user.bannerUrl = bannerUrl;
      break;
    }
  }
  return sanitizeUser(user);
}

function getTrends() {
  const posts = getRows("Posts");
  const tagMap = {};

  posts.forEach(p => {
    const matches = p.text.match(/#([\p{L}\d_]+)/gu) || [];
    matches.forEach(t => tagMap[t] = (tagMap[t] || 0) + 1);
  });

  return Object.keys(tagMap).map(tag => ({
    tag: tag, count: tagMap[tag]
  })).sort((a, b) => b.count - a.count).slice(0, 5);
}

function getPeople(req, token) {
  const user = getUserByToken(token);
  const users = getRows("Users");
  const followers = getRows("Followers");
  const query = String((req && req.q) || "").trim().toLowerCase().replace(/^@/, "");

  return users.filter(u => {
    if (user && String(u.id) === String(user.id)) return false;
    if (!query) return true;
    return (String(u.name || "") + " " + String(u.username || "")).toLowerCase().includes(query);
  }).slice(0, query ? 30 : 10).map(u => ({
    name: u.name,
    handle: "@" + u.username,
    initial: (u.name || u.username)[0].toUpperCase(),
    color: u.color,
    ink: u.ink,
    avatarUrl: u.avatarUrl || "",
    bannerUrl: u.bannerUrl || "",
    verified: String(u.username).toLowerCase() === "roby" || String(u.verified).toLowerCase() === "true",
    following: user ? followers.some(f => f.followerHandle === "@" + user.username && f.targetHandle === "@" + u.username) : false
  }));
}

/* ================= ROOMS ================= */
function getRooms(req, token) {
  const user = getUserByToken(token);
  let rooms = getRows("Rooms");
  const members = getRows("RoomMembers");

  if (req.filter === "private") rooms = rooms.filter(r => r.access === "private");
  if (req.filter === "public") rooms = rooms.filter(r => r.access === "public");
  if (req.filter === "mine" && user) rooms = rooms.filter(r => r.ownerHandle === "@" + user.username);

  if (req.q) {
    const q = req.q.toLowerCase();
    rooms = rooms.filter(r => (r.name + " " + r.description + " " + r.category).toLowerCase().includes(q));
  }

  const items = rooms.map(r => {
    const isJoined = user ? members.some(m => String(m.roomId) === String(r.id) && String(m.userId) === String(user.id)) : false;
    return {
      id: String(r.id),
      name: r.name,
      description: r.description,
      category: r.category,
      emoji: r.emoji,
      access: r.access,
      verified: r.verified === true || r.verified === "true",
      members: members.filter(m => String(m.roomId) === String(r.id)).length + 1,
      joined: isJoined
    };
  });

  return { items: items };
}

function getRoomDetail(req, token) {
  const user = getUserByToken(token);
  const room = getRows("Rooms").find(r => String(r.id) === String(req.id));
  if (!room) throw new Error("Ruang tidak ditemukan.");

  const members = getRows("RoomMembers");
  const isJoined = user ? members.some(m => String(m.roomId) === String(room.id) && String(m.userId) === String(user.id)) : false;

  if (room.access === "private" && !isJoined && String(room.ownerHandle) !== (user ? "@" + user.username : "")) {
    return { locked: true, room: { id: room.id, name: room.name } };
  }

  let posts = getRows("RoomPosts").filter(rp => String(rp.roomId) === String(room.id));
  if (req.q) {
    const q = req.q.toLowerCase();
    posts = posts.filter(p => p.text.toLowerCase().includes(q));
  }

  return {
    locked: false,
    room: {
      id: room.id,
      name: room.name,
      description: room.description,
      category: room.category,
      emoji: room.emoji,
      members: members.filter(m => String(m.roomId) === String(room.id)).length + 1,
      joined: isJoined
    },
    posts: posts.map(p => ({
      id: String(p.id),
      name: p.name,
      handle: p.handle,
      text: p.text,
      likes: Number(p.likes) || 0,
      createdAt: Number(p.createdAt)
    }))
  };
}

function createRoom(req, user) {
  const name = (req.name || "").trim();
  const description = (req.description || "").trim();

  if (!name || !description) throw new Error("Nama dan deskripsi Ruang wajib diisi.");

  const id = "RM_" + Date.now();
  getSheet("Rooms").appendRow([
    id, name, description, req.category || "Umum", req.emoji || "💬",
    req.access || "public", req.password || "", "@" + user.username, 1, Date.now()
  ]);

  getSheet("RoomMembers").appendRow([id, user.id]);
  return { id: id };
}

function joinRoom(req, user) {
  const room = getRows("Rooms").find(r => String(r.id) === String(req.id));
  if (!room) throw new Error("Ruang tidak ditemukan.");

  if (room.access === "private" && req.password !== room.password) {
    throw new Error("Password Ruang salah.");
  }

  const sheet = getSheet("RoomMembers");
  sheet.appendRow([req.id, user.id]);
  return true;
}

function leaveRoom(req, user) {
  const sheet = getSheet("RoomMembers");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(req.id) && String(data[i][1]) === String(user.id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return true;
}

function createRoomPost(req, user) {
  const text = (req.text || "").trim();
  if (!text) throw new Error("Teks tidak boleh kosong.");

  const id = "RP_" + Date.now();
  getSheet("RoomPosts").appendRow([
    id, req.roomId, user.id, user.name, "@" + user.username, text, 0, Date.now()
  ]);
  return true;
}

function likeRoomPost(req, user) {
  const sheet = getSheet("RoomPosts");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(req.id)) {
      const current = Number(data[i][6]) || 0;
      sheet.getRange(i + 1, 7).setValue(current + 1);
      const room = getRows("Rooms").find(r => String(r.id) === String(data[i][1]));
      const owner = room && getUserByUsername(String(room.ownerHandle || "").replace(/^@/, ""));
      if (owner) createNotification(owner.id, "room_like", user, req.id, user.name + " menyukai diskusi di Ruangmu.");
      return true;
    }
  }
  return true;
}

/* ================= REELS & GIFTS ================= */
function getReels(req, token) {
  const user = getUserByToken(token);
  let reels = getRows("Reels");

  if (reels.length === 0) {
    reels = [
      { id: "RL_1", user: "Alya Rahma", handle: "@alyarahma", initial: "A", emoji: "🌅", caption: "Mulai hari dengan satu langkah kecil. #Motivasi", audio: "♫ Original audio · Alya" },
      { id: "RL_2", user: "Dimas Pratama", handle: "@dimaspr", initial: "D", emoji: "💻", caption: "3 tools gratis yang membantu produktivitas! #Teknologi", audio: "♫ Lo-fi study beat" }
    ];
  }

  const likes = getRows("ReelLikes");
  const saves = getRows("ReelSaves");

  const items = reels.map(r => ({
    id: String(r.id),
    user: r.user,
    handle: r.handle,
    initial: r.initial,
    emoji: r.emoji,
      caption: r.caption,
      audio: r.audio,
      mediaUrl: r.mediaUrl || "",
      mediaType: r.mediaType || "",
    likes: likes.filter(l => String(l.reelId) === String(r.id)).length + 120,
    liked: user ? likes.some(l => String(l.reelId) === String(r.id) && String(l.userId) === String(user.id)) : false,
    saved: user ? saves.some(s => String(s.reelId) === String(r.id) && String(s.userId) === String(user.id)) : false
  }));

  return { items: items };
}

function toggleReelLike(req, user) {
  const result = toggleRelation("ReelLikes", "reelId", req.id, user.id);
  if (result.on) {
    const reel = getRows("Reels").find(r => String(r.id) === String(req.id));
    const owner = reel && getUserByUsername(String(reel.handle || "").replace(/^@/, ""));
    if (owner) createNotification(owner.id, "reel_like", user, req.id, user.name + " menyukai videomu.");
  }
  return result;
}
function toggleReelSave(req, user) {
  return toggleRelation("ReelSaves", "reelId", req.id, user.id);
}

function sendGift(req, user) {
  const giftsCost = { Mawar: 10, Hati: 25, Kopi: 50, Bintang: 100, Berlian: 250, Roket: 500, Mahkota: 800, Perayaan: 120 };
  const cost = giftsCost[req.gift] || 10;

  if (user.coins < cost) throw new Error("Saldo koin tidak mencukupi.");

  const newCoins = user.coins - cost;
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id)) {
      sheet.getRange(i + 1, 9).setValue(newCoins);
      break;
    }
  }

  getSheet("Gifts").appendRow(["G_" + Date.now(), req.reelId, user.id, req.gift, cost, Date.now()]);
  return { coins: newCoins };
}

/* ================= CREATOR STUDIO ================= */
function getCreatorData(user) {
  const myPosts = getRows("Posts").filter(p => String(p.userId) === String(user.id));
  const likes = getRows("Likes");
  const gifts = getRows("Gifts");

  let totalLikes = 0;
  myPosts.forEach(p => {
    totalLikes += likes.filter(l => String(l.postId) === String(p.id)).length;
  });

  const myGifts = gifts.filter(g => String(g.senderUserId) === String(user.id));
  const totalGifts = myGifts.length;
  const estimatedProfit = (totalLikes * 500) + (totalGifts * 2000);

  return {
    likes: totalLikes,
    profit: estimatedProfit,
    giftsReceived: totalGifts,
    coins: user.coins || 1250,
    posts: myPosts.map(p => ({
      text: p.text.slice(0, 90),
      likes: likes.filter(l => String(l.postId) === String(p.id)).length
    }))
  };
}

/* ================= MEDIA UPLOAD ================= */
function uploadMedia(req, user) {
  const dataUrl = String(req.dataUrl || "");
  const mediaType = String(req.mediaType || "").toLowerCase();
  const name = String(req.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) throw new Error("Format media tidak valid.");
  if (dataUrl.length > 12000000) throw new Error("Ukuran media terlalu besar. Maksimal sekitar 8 MB.");
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  const contentType = match[1];
  if (mediaType && contentType.indexOf(mediaType + "/") !== 0) throw new Error("Jenis media tidak sesuai.");
  const bytes = Utilities.base64Decode(match[2]);
  const folderId = PropertiesService.getScriptProperties().getProperty("RUMA_MEDIA_FOLDER_ID");
  const blob = Utilities.newBlob(bytes, contentType, name);
  const file = folderId ? DriveApp.getFolderById(folderId).createFile(blob) : DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), url: "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000", type: contentType, name: name, ownerId: user.id };
}

/* ================= REPORTS AND ADMIN ================= */
function isAdmin(user) {
  return user && String(user.status || "active") !== "blocked" &&
    (String(user.role || "").toLowerCase() === "admin" || String(user.username).toLowerCase() === "roby");
}

function requireAdmin(user) {
  if (!isAdmin(user)) throw new Error("Akses admin diperlukan.");
}

function reportPost(req, user) {
  if (!getRows("Posts").some(p => String(p.id) === String(req.postId))) throw new Error("Postingan tidak ditemukan.");
  getSheet("Reports").appendRow(["REP_" + Utilities.getUuid(), req.postId, user.id, "@" + user.username, String(req.reason || "Pelanggaran panduan"), "open", Date.now(), ""]);
  return true;
}

function adminAction(action, req, user) {
  requireAdmin(user);
  if (action === "adminOverview") {
    const reports = getRows("Reports");
    return { users: getRows("Users").length, posts: getRows("Posts").length, rooms: getRows("Rooms").length, reels: getRows("Reels").length, openReports: reports.filter(r => String(r.status || "open") !== "resolved").length };
  }
  if (action === "adminUsers") return { items: getRows("Users").map(sanitizeUser) };
  if (action === "adminPosts") return { items: getRows("Posts").reverse().map(p => ({ id: String(p.id), text: p.text, handle: p.handle, name: p.name, topic: p.topic, mediaUrl: p.mediaUrl || "", mediaType: p.mediaType || "", createdAt: Number(p.createdAt) })) };
  if (action === "adminReports") return { items: getRows("Reports").reverse().map(r => ({ id: String(r.id), postId: String(r.postId), reporterHandle: r.reporterHandle, reason: r.reason, status: r.status || "open", createdAt: Number(r.createdAt) })) };
  if (action === "adminUpdateUser") {
    const target = getRows("Users").find(u => String(u.id) === String(req.id));
    if (!target) throw new Error("Pengguna tidak ditemukan.");
    if (String(target.username).toLowerCase() === "roby" && (req.status === "blocked" || (req.role && req.role !== "admin"))) throw new Error("Admin utama tidak dapat diblokir atau diturunkan role-nya.");
    const sheet = getSheet("Users");
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) if (String(data[i][0]) === String(req.id)) {
      if (["active", "blocked"].indexOf(req.status) >= 0) sheet.getRange(i + 1, 12).setValue(req.status);
      if (["admin", "moderator", "user"].indexOf(req.role) >= 0) sheet.getRange(i + 1, 11).setValue(req.role);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const verifiedColumn = headers.indexOf("verified") + 1;
      if (verifiedColumn > 0 && typeof req.verified === "boolean") sheet.getRange(i + 1, verifiedColumn).setValue(String(target.username).toLowerCase() === "roby" ? true : req.verified);
      return true;
    }
  }
  if (action === "adminDeletePost") {
    const sheet = getSheet("Posts"), data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) if (String(data[i][0]) === String(req.id)) { sheet.deleteRow(i + 1); return true; }
    throw new Error("Postingan tidak ditemukan.");
  }
  if (action === "adminResolveReport") {
    const sheet = getSheet("Reports"), data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) if (String(data[i][0]) === String(req.id)) { sheet.getRange(i + 1, 6).setValue("resolved"); sheet.getRange(i + 1, 8).setValue(Date.now()); return true; }
    throw new Error("Laporan tidak ditemukan.");
  }
}
