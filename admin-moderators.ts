// Individual moderator accounts. Passwords are hashed by Bun using Argon2id.
// Moderators have no owner-level finance, legal, access-grant or account-management privileges.
export async function prepareModerators(sql){
 await sql("CREATE TABLE IF NOT EXISTS mm_admin_moderators(id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}
export function moderatorInput(username,password){
 const name=String(username||"").trim().toLowerCase(),secret=String(password||"");
 if(!/^[a-z0-9_.-]{3,32}$/.test(name))throw Error("Логин: 3–32 латинские буквы, цифры, точка, дефис или подчёркивание");
 if(secret.length<16||secret.length>256)throw Error("Пароль модератора должен содержать 16–256 символов");
 return {name,secret};
}
export async function createModerator(sql,username,password){
 const {name,secret}=moderatorInput(username,password);
 const passwordHash=await Bun.password.hash(secret,{algorithm:"argon2id"});
 const rows=await sql("INSERT INTO mm_admin_moderators(username,password_hash) VALUES($1,$2) ON CONFLICT(username) DO NOTHING RETURNING id,username,active",name,passwordHash);
 if(!rows.length)throw Error("Этот логин уже занят. Для смены пароля создайте новую учётную запись.");
 return rows[0];
}
export async function authenticateModerator(sql,username,password){
 const name=String(username||"").trim().toLowerCase(),secret=String(password||"");
 if(!/^[a-z0-9_.-]{3,32}$/.test(name)||!secret)return null;
 const rows=await sql("SELECT id,username,password_hash FROM mm_admin_moderators WHERE username=$1 AND active=TRUE",name);
 if(!rows.length)return null;
 if(!await Bun.password.verify(secret,rows[0].password_hash))return null;
 return {id:rows[0].id,username:rows[0].username};
}
export async function updateModeratorStatus(sql,id,enabled){
 const key=Number(id);
 if(!Number.isSafeInteger(key)||key<=0)throw Error("Некорректный номер модератора");
 const rows=await sql("UPDATE mm_admin_moderators SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,username,active",!!enabled,key);
 return rows[0]||null;
}
