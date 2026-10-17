require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const { authenticate, requireAdmin, validate } = require("./middleware");
const {
  registerSchema, loginSchema, participantSchema, resultSchema,
  stageSchema, competitionSchema, passCountSchema
} = require("./validation");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("Ошибка конфигурации: задайте JWT_SECRET длиной не менее 32 символов в .env");
  process.exit(1);
}

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5500" }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const asInt = value => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, "INVALID_ID", "ID должен быть положительным целым числом");
  return n;
};
const one = (sql, ...params) => db.prepare(sql).get(...params);
const many = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const publicUser = u => ({ id: u.id, fullName: u.full_name, email: u.email, role: u.role });
const issueToken = u => jwt.sign({ role: u.role, email: u.email }, process.env.JWT_SECRET, { subject: String(u.id), expiresIn: process.env.JWT_EXPIRES_IN || "2h" });

app.get("/api/health", (req,res) => res.json({ data: { status: "ok" } }));

// Registration is public, but the public endpoint can never assign the admin role.
app.post("/api/auth/register", validate(registerSchema), (req,res,next) => {
  try {
    const { fullName, email, password } = req.body;
    const hash = bcrypt.hashSync(password, 12);
    const info = run("INSERT INTO users(full_name,email,password_hash,role) VALUES(?,?,?,'participant')", fullName, email, hash);
    const user = one("SELECT * FROM users WHERE id=?", info.lastInsertRowid);
    res.status(201).json({ data: { user: publicUser(user), token: issueToken(user) } });
  } catch (e) { next(e); }
});

app.post("/api/auth/login", validate(loginSchema), (req,res) => {
  const user = one("SELECT * FROM users WHERE email=?", req.body.email);
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Неверный email или пароль" } });
  }
  res.json({ data: { user: publicUser(user), token: issueToken(user) } });
});

app.get("/api/auth/me", authenticate, (req,res) => {
  const user = one("SELECT * FROM users WHERE id=?", Number(req.user.id));
  if (!user) throw httpError(401, "USER_NOT_FOUND", "Пользователь не найден");
  res.json({ data: { user: publicUser(user) } });
});

// Competitions and stages
app.get("/api/competitions", (req,res) => {
  res.json({ data: many("SELECT * FROM competitions ORDER BY start_date DESC") });
});
app.post("/api/competitions", authenticate, requireAdmin, validate(competitionSchema), (req,res,next) => {
  try {
    const v = req.body;
    const info = run("INSERT INTO competitions(specialty,title,start_date,end_date) VALUES(?,?,?,?)", v.specialty,v.title,v.startDate,v.endDate);
    const id = Number(info.lastInsertRowid);
    const dates = [v.startDate, addDays(v.startDate, 2), addDays(v.startDate, 4)];
    const tx = db.transaction(() => {
      dates.forEach((date,i) => run("INSERT INTO stages(competition_id,stage_number,title,stage_date,status) VALUES(?,?,?,?,?)",id,i+1,["Первый этап","Второй этап","Финальный этап"][i],date,i===0?"open":"planned"));
      run("INSERT INTO qualification_rules(competition_id,pass_count) VALUES(?,?)",id,10);
    });
    tx();
    res.status(201).json({ data: { competition: one("SELECT * FROM competitions WHERE id=?",id), stages: many("SELECT * FROM stages WHERE competition_id=? ORDER BY stage_number",id) } });
  } catch(e) { next(e); }
});
app.get("/api/competitions/:id/stages", (req,res) => {
  const id=asInt(req.params.id);
  if(!one("SELECT id FROM competitions WHERE id=?",id)) throw httpError(404,"NOT_FOUND","Соревнование не найдено");
  res.json({ data: many("SELECT * FROM stages WHERE competition_id=? ORDER BY stage_number",id) });
});
app.patch("/api/stages/:id/status", authenticate, requireAdmin, (req,res) => {
  const id=asInt(req.params.id), stage=one("SELECT * FROM stages WHERE id=?",id);
  if(!stage) throw httpError(404,"NOT_FOUND","Этап не найден");
  const { status }=req.body;
  if(!["planned","open","closed"].includes(status)) throw httpError(400,"INVALID_STATUS","Статус должен быть planned, open или closed");
  const allowed={planned:["open"],open:["closed"],closed:[]};
  if(!allowed[stage.status].includes(status)) throw httpError(409,"INVALID_STATE_TRANSITION",`Нельзя изменить статус ${stage.status} на ${status}`);
  run("UPDATE stages SET status=? WHERE id=?",status,id);
  res.json({ data: one("SELECT * FROM stages WHERE id=?",id) });
});

// Participants: list/search/filter is available to authenticated users; writes are admin-only.
app.get("/api/participants", authenticate, (req,res) => {
  const { specialty, search, sort="name_asc" }=req.query;
  const sorts={name_asc:"full_name COLLATE NOCASE ASC",name_desc:"full_name COLLATE NOCASE DESC",points_asc:"total_points ASC",points_desc:"total_points DESC"};
  if(!sorts[sort]) throw httpError(400,"INVALID_SORT","Недопустимый параметр sort");
  const rows=many(`SELECT p.*, COALESCE(SUM(r.points),0) AS total_points FROM participants p LEFT JOIN results r ON r.participant_id=p.id WHERE (? IS NULL OR p.specialty=?) AND (? IS NULL OR p.full_name LIKE '%'||?||'%' OR p.group_name LIKE '%'||?||'%' OR p.specialty LIKE '%'||?||'%') GROUP BY p.id ORDER BY ${sorts[sort]}`,specialty||null,specialty||null,search||null,search||null,search||null,search||null);
  res.json({ data: rows });
});
app.post("/api/participants", authenticate, requireAdmin, validate(participantSchema), (req,res) => {
  const v=req.body;
  const info=run("INSERT INTO participants(full_name,group_name,specialty,user_id) VALUES(?,?,?,?)",v.fullName,v.groupName,v.specialty,v.userId??null);
  res.status(201).json({ data: one("SELECT * FROM participants WHERE id=?",info.lastInsertRowid) });
});
app.patch("/api/participants/:id", authenticate, requireAdmin, validate(participantSchema.partial()), (req,res) => {
  const id=asInt(req.params.id), old=one("SELECT * FROM participants WHERE id=?",id);
  if(!old) throw httpError(404,"NOT_FOUND","Участник не найден");
  const v=req.body;
  const map={fullName:"full_name",groupName:"group_name",specialty:"specialty",userId:"user_id"};
  const entries=Object.entries(v);
  if(!entries.length) throw httpError(400,"EMPTY_UPDATE","Нет полей для изменения");
  run(`UPDATE participants SET ${entries.map(([k])=>`${map[k]}=?`).join(",")} WHERE id=?`,...entries.map(([k,val])=>val),id);
  res.json({ data: one("SELECT * FROM participants WHERE id=?",id) });
});
app.delete("/api/participants/:id", authenticate, requireAdmin, (req,res) => {
  const id=asInt(req.params.id);
  const info=run("DELETE FROM participants WHERE id=?",id);
  if(!info.changes) throw httpError(404,"NOT_FOUND","Участник не найден");
  res.status(204).end();
});

// Enter/update results only while a stage is open; total is calculated on the server.
app.put("/api/stages/:stageId/results", authenticate, requireAdmin, validate(resultSchema), (req,res) => {
  const stageId=asInt(req.params.stageId), stage=one("SELECT * FROM stages WHERE id=?",stageId);
  if(!stage) throw httpError(404,"NOT_FOUND","Этап не найден");
  if(stage.status!=="open") throw httpError(409,"STAGE_NOT_OPEN","Ввод результатов разрешён только для открытого этапа");
  const {participantId,points,comment}=req.body;
  if(points>stage.max_points) throw httpError(422,"POINTS_LIMIT",`Максимум для этого этапа — ${stage.max_points} баллов`);
  const participant=one("SELECT * FROM participants WHERE id=?",participantId);
  if(!participant) throw httpError(404,"PARTICIPANT_NOT_FOUND","Участник не найден");
  const competition=one("SELECT * FROM competitions WHERE id=?",stage.competition_id);
  if(participant.specialty!==competition.specialty) throw httpError(422,"SPECIALTY_MISMATCH","Участник не относится к специальности этого соревнования");
  run(`INSERT INTO results(participant_id,stage_id,points,comment,entered_by) VALUES(?,?,?,?,?)
       ON CONFLICT(participant_id,stage_id) DO UPDATE SET points=excluded.points,comment=excluded.comment,entered_by=excluded.entered_by,updated_at=CURRENT_TIMESTAMP`,
       participantId,stageId,points,comment,Number(req.user.id));
  res.json({ data: { result: one("SELECT * FROM results WHERE participant_id=? AND stage_id=?",participantId,stageId),
    totalPoints: one("SELECT COALESCE(SUM(points),0) AS total FROM results WHERE participant_id=? AND stage_id IN (SELECT id FROM stages WHERE competition_id=?)",participantId,stage.competition_id).total } });
});

app.get("/api/competitions/:id/ranking", authenticate, (req,res) => {
  const id=asInt(req.params.id), comp=one("SELECT * FROM competitions WHERE id=?",id);
  if(!comp) throw httpError(404,"NOT_FOUND","Соревнование не найдено");
  const ranking=many(`SELECT p.id,p.full_name,p.group_name,p.specialty,COALESCE(SUM(r.points),0) AS total_points,
    COUNT(DISTINCT r.stage_id) AS completed_stages
    FROM participants p LEFT JOIN results r ON r.participant_id=p.id
    LEFT JOIN stages s ON s.id=r.stage_id AND s.competition_id=?
    WHERE p.specialty=? GROUP BY p.id ORDER BY total_points DESC,p.full_name COLLATE NOCASE ASC`,id,comp.specialty);
  // Avoid counting results from other competitions in ranking totals.
  const clean=ranking.map(p=>({...p,total_points:one("SELECT COALESCE(SUM(r.points),0) AS total FROM results r JOIN stages s ON s.id=r.stage_id WHERE r.participant_id=? AND s.competition_id=?",p.id,id).total,
    completed_stages:one("SELECT COUNT(DISTINCT r.stage_id) AS n FROM results r JOIN stages s ON s.id=r.stage_id WHERE r.participant_id=? AND s.competition_id=?",p.id,id).n}));
  const rule=one("SELECT pass_count FROM qualification_rules WHERE competition_id=?",id);
  res.json({ data: { competition:comp, ranking:clean.map((p,i)=>({...p,place:i+1,qualified:!!rule&&i<rule.pass_count})), passCount:rule?.pass_count??null } });
});
app.put("/api/competitions/:id/qualification", authenticate, requireAdmin, validate(passCountSchema), (req,res) => {
  const id=asInt(req.params.id);
  if(!one("SELECT id FROM competitions WHERE id=?",id)) throw httpError(404,"NOT_FOUND","Соревнование не найдено");
  run("INSERT INTO qualification_rules(competition_id,pass_count) VALUES(?,?) ON CONFLICT(competition_id) DO UPDATE SET pass_count=excluded.pass_count,updated_at=CURRENT_TIMESTAMP",id,req.body.passCount);
  res.json({ data: one("SELECT * FROM qualification_rules WHERE competition_id=?",id) });
});

function addDays(date, days) {
  const d=new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

// Consistent JSON error format, including SQLite constraint errors.
app.use((err,req,res,next)=>{
  if(res.headersSent) return next(err);
  if(err.status) return res.status(err.status).json({error:{code:err.code||"REQUEST_ERROR",message:err.message}});
  if(err.code==="SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({error:{code:"DUPLICATE_RESOURCE",message:"Такая запись уже существует"}});
  if(err.code==="SQLITE_CONSTRAINT_FOREIGNKEY") return res.status(422).json({error:{code:"INVALID_REFERENCE",message:"Указана несуществующая связанная запись"}});
  if(err instanceof SyntaxError && "body" in err) return res.status(400).json({error:{code:"INVALID_JSON",message:"Тело запроса содержит некорректный JSON"}});
  console.error(err);
  res.status(500).json({error:{code:"INTERNAL_ERROR",message:"Внутренняя ошибка сервера"}});
});
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Competition API listening on http://localhost:${port}`));
