/**
 * RUMA Apps Script extension
 *
 * Copy this file below the existing Apps Script code.
 * Then add the route block from addAdminRoutes() inside doPost(), immediately
 * after: const user = getUserByToken(token);
 * and run setupAdminAccount() once from the Apps Script editor.
 *
 * Add this block inside doPost() immediately after:
 *   const user = getUserByToken(token);
 *   if (!user) return reply(false, "Sesi telah berakhir. Silakan login kembali.", "UNAUTH");
 *
 *   if (["adminOverview", "adminUsers", "adminPosts", "adminReports",
 *        "adminUpdateUser", "adminDeletePost", "adminResolveReport",
 *        "reportPost"].indexOf(action) >= 0) {
 *     return reply(true, "", null, addAdminRoutes(action, req, user));
 *   }
 *
 * This extension keeps the existing spreadsheet data and adds:
 * - admin role and account status
 * - username editing
 * - admin overview, user, post, and report management
 * - post reporting
 */

function addAdminRoutes(action, req, user) {
  if (action === "adminOverview") return adminOverview(user);
  if (action === "adminUsers") return adminUsers(user);
  if (action === "adminPosts") return adminPosts(user);
  if (action === "adminReports") return adminReports(user);
  if (action === "adminUpdateUser") return adminUpdateUser(req, user);
  if (action === "adminDeletePost") return adminDeletePost(req, user);
  if (action === "adminResolveReport") return adminResolveReport(req, user);
  if (action === "reportPost") return reportPost(req, user);
  return null;
}

function ensureColumns(sheetName, names) {
  const sheet = getSheet(sheetName);
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  if (headers.length === 1 && !headers[0]) {
    sheet.getRange(1, 1).setValue(names[0]);
    headers[0] = names[0];
    names = names.slice(1);
  }
  names.forEach(function(name) {
    if (headers.indexOf(name) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(name);
      headers.push(name);
    }
  });
  return sheet;
}

function headerIndex(sheet, name) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = headers.indexOf(name);
  if (index === -1) throw new Error("Kolom tidak ditemukan: " + name);
  return index + 1;
}

function setColumnValue(sheet, row, name, value) {
  sheet.getRange(row, headerIndex(sheet, name)).setValue(value);
}

function ensureRumaSchema() {
  ensureColumns("Users", ["role", "status"]);
  ensureColumns("Reports", ["id", "postId", "reporterUserId", "reporterHandle", "reason", "status", "createdAt", "resolvedAt"]);
}

function isAdmin(user) {
  return user && (String(user.role || "").toLowerCase() === "admin" ||
    String(user.username || "").toLowerCase() === "roby");
}

function requireAdmin(user) {
  if (!isAdmin(user)) throw new Error("Akses admin diperlukan.");
  if (String(user.status || "active").toLowerCase() === "blocked") {
    throw new Error("Akun admin sedang diblokir.");
  }
  return user;
}

/**
 * Run this function once manually in Apps Script.
 * It creates or repairs the requested admin account.
 */
function setupAdminAccount() {
  ensureRumaSchema();
  const sheet = getSheet("Users");
  const users = getRows("Users");
  const existing = users.find(function(item) {
    return String(item.username || "").toLowerCase() === "roby";
  });

  if (existing) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(existing.id)) {
        setColumnValue(sheet, i + 1, "password", "tauhid12");
        setColumnValue(sheet, i + 1, "name", "Roby");
        setColumnValue(sheet, i + 1, "role", "admin");
        setColumnValue(sheet, i + 1, "status", "active");
        return "Admin roby diperbarui.";
      }
    }
  }

  const id = "U_" + Utilities.getUuid();
  const palette = ["#e8efff", "#2859a8"];
  const row = [id, "roby", "tauhid12", "Roby", "", "Administrator RUMA",
    palette[0], palette[1], 1250, Date.now(), "admin", "active"];
  sheet.appendRow(row);
  return "Admin roby berhasil dibuat.";
}

function doLogin(req) {
  ensureColumns("Users", ["role", "status"]);
  const username = String(req.username || "").toLowerCase().trim().replace(/^@/, "");
  const password = String(req.password || "");
  const users = getRows("Users");
  const user = users.find(function(item) {
    return String(item.username || "").toLowerCase() === username &&
      String(item.password || "") === password;
  });
  if (!user) throw new Error("Username atau password salah.");
  if (String(user.status || "active").toLowerCase() === "blocked") {
    throw new Error("Akun ini diblokir.");
  }

  const newToken = "TK_" + Utilities.getUuid();
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id)) {
      setColumnValue(sheet, i + 1, "token", newToken);
      user.token = newToken;
      break;
    }
  }
  return {user: sanitizeUser(user), token: newToken};
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
    role: u.role || "user",
    status: u.status || "active",
    followers: getRows("Followers").filter(function(f) {
      return f.targetHandle === "@" + u.username;
    }).length,
    following: getRows("Followers").filter(function(f) {
      return f.followerHandle === "@" + u.username;
    }).length
  };
}

/**
 * Replace the old updateProfile function with this version or leave this
 * declaration below it. The later declaration is the active one in Apps Script.
 */
function updateProfile(req, user) {
  ensureColumns("Users", ["role", "status"]);
  const name = String(req.name || user.name || "").trim();
  const bio = String(req.bio || "").trim();
  const requestedUsername = String(req.username || user.username).trim().toLowerCase().replace(/^@/, "");

  if (!name) throw new Error("Nama wajib diisi.");
  if (!/^[a-z0-9_]{3,20}$/.test(requestedUsername)) {
    throw new Error("Username hanya boleh berisi huruf kecil, angka, dan _ (3-20 karakter).");
  }

  const users = getRows("Users");
  const duplicate = users.some(function(item) {
    return String(item.id) !== String(user.id) &&
      String(item.username || "").toLowerCase() === requestedUsername;
  });
  if (duplicate) throw new Error("Username sudah digunakan.");

  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(user.id)) {
      setColumnValue(sheet, i + 1, "username", requestedUsername);
      setColumnValue(sheet, i + 1, "name", name);
      setColumnValue(sheet, i + 1, "bio", bio);
      user.username = requestedUsername;
      user.name = name;
      user.bio = bio;
      break;
    }
  }
  return sanitizeUser(user);
}

function adminOverview(user) {
  requireAdmin(user);
  ensureRumaSchema();
  const reports = getRows("Reports");
  return {
    users: getRows("Users").length,
    posts: getRows("Posts").length,
    rooms: getRows("Rooms").length,
    reels: getRows("Reels").length,
    openReports: reports.filter(function(r) {
      return String(r.status || "open") !== "resolved";
    }).length
  };
}

function adminUsers(user) {
  requireAdmin(user);
  ensureRumaSchema();
  return {
    items: getRows("Users").map(function(item) {
      return sanitizeUser(item);
    })
  };
}

function adminPosts(user) {
  requireAdmin(user);
  return {
    items: getRows("Posts").map(function(post) {
      return {
        id: String(post.id),
        text: post.text,
        handle: post.handle,
        name: post.name,
        createdAt: Number(post.createdAt),
        topic: post.topic || "Diskusi"
      };
    }).reverse()
  };
}

function adminReports(user) {
  requireAdmin(user);
  ensureRumaSchema();
  return {
    items: getRows("Reports").map(function(report) {
      return {
        id: String(report.id),
        postId: String(report.postId),
        reporterHandle: report.reporterHandle,
        reason: report.reason,
        status: report.status || "open",
        createdAt: Number(report.createdAt)
      };
    }).reverse()
  };
}

function adminUpdateUser(req, user) {
  requireAdmin(user);
  ensureColumns("Users", ["role", "status"]);
  const targetId = String(req.id || "");
  const target = getRows("Users").find(function(item) {
    return String(item.id) === targetId;
  });
  if (!target) throw new Error("Pengguna tidak ditemukan.");
  if (target.username === "roby" && req.status === "blocked") {
    throw new Error("Admin utama tidak dapat diblokir.");
  }
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === targetId) {
      if (req.status) setColumnValue(sheet, i + 1, "status", req.status);
      if (req.role && ["admin", "moderator", "user"].indexOf(req.role) >= 0) {
        setColumnValue(sheet, i + 1, "role", req.role);
      }
      return true;
    }
  }
  return true;
}

function adminDeletePost(req, user) {
  requireAdmin(user);
  const sheet = getSheet("Posts");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(req.id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  throw new Error("Postingan tidak ditemukan.");
}

function reportPost(req, user) {
  if (!user) throw new Error("Login diperlukan untuk melaporkan postingan.");
  const post = getRows("Posts").find(function(item) {
    return String(item.id) === String(req.postId);
  });
  if (!post) throw new Error("Postingan tidak ditemukan.");
  ensureRumaSchema();
  getSheet("Reports").appendRow([
    "REP_" + Date.now(), req.postId, user.id, "@" + user.username,
    String(req.reason || "Pelanggaran panduan").trim(), "open", Date.now(), ""
  ]);
  return true;
}

function adminResolveReport(req, user) {
  requireAdmin(user);
  ensureRumaSchema();
  const sheet = getSheet("Reports");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(req.id)) {
      setColumnValue(sheet, i + 1, "status", "resolved");
      setColumnValue(sheet, i + 1, "resolvedAt", Date.now());
      return true;
    }
  }
  throw new Error("Laporan tidak ditemukan.");
}
