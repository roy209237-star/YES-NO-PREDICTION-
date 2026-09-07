require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const { Server } = require("socket.io");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || true, credentials: true }
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureSchema() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ`);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
app.use("/api/auth", authLimiter);

function normalizePhone(phone) {
  return String(phone || "").replace(/[^+0-9]/g, "");
}
function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  try {
    const token = req.cookies.token || (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "Login required" });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Invalid or expired session" }); }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
function marketView(m) {
  const yes = Number(m.yes_count || 0), no = Number(m.no_count || 0), total = yes + no;
  return {
    id: m.id, title: m.title, description: m.description,
    closesAt: m.closes_at, status: m.status, result: m.result,
    yesCount: yes, noCount: no,
    yesPct: total ? Math.round(yes / total * 100) : 50,
    noPct: total ? Math.round(no / total * 100) : 50
  };
}

app.post("/api/auth/register", async (req,res) => {
  try {
    const { name, email, password } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!name || !email || !password || password.length < 8 || phone.length < 8)
      return res.status(400).json({ error: "Name, phone, email and 8+ character password required" });
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO users(name,email,phone,password_hash) VALUES($1,$2,$3,$4)
       RETURNING id,name,email,phone,role,points`,
      [name.trim(), email.toLowerCase().trim(), phone, hash]);
    res.cookie("token", sign(r.rows[0]), { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", maxAge:7*864e5 });
    res.json({ user:r.rows[0] });
  } catch(e) {
    if (e.code === "23505") return res.status(409).json({ error:"Email or phone already registered" });
    console.error(e); res.status(500).json({error:"Registration failed"});
  }
});

// Demo OTP flow. For production, connect an SMS provider (e.g. Twilio, MSG91, etc.)
// and NEVER return the OTP in the API response.
app.post("/api/auth/request-otp", async (req,res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (phone.length < 8) return res.status(400).json({error:"Enter a valid mobile number"});
    const r = await pool.query(`SELECT id FROM users WHERE phone=$1`,[phone]);
    if (!r.rows[0]) return res.status(404).json({error:"No account found for this mobile number. Register first."});
    const otp = String(Math.floor(100000 + Math.random()*900000));
    const hash = await bcrypt.hash(otp, 10);
    await pool.query(`UPDATE users SET otp_hash=$1,otp_expires_at=NOW()+INTERVAL '5 minutes' WHERE id=$2`,
      [hash,r.rows[0].id]);
    console.log(`[DEMO OTP] ${phone}: ${otp}`);
    res.json({ok:true, message:"OTP generated. In demo mode check the server console."});
  } catch(e){console.error(e);res.status(500).json({error:"Could not send OTP"});}
});

app.post("/api/auth/verify-otp", async (req,res) => {
  try {
    const phone = normalizePhone(req.body.phone), otp=String(req.body.otp||"");
    const r=await pool.query(`SELECT * FROM users WHERE phone=$1`,[phone]);
    const u=r.rows[0];
    if(!u || !u.otp_hash || !u.otp_expires_at || new Date(u.otp_expires_at)<new Date())
      return res.status(401).json({error:"OTP expired or invalid"});
    if(!(await bcrypt.compare(otp,u.otp_hash))) return res.status(401).json({error:"Invalid OTP"});
    await pool.query(`UPDATE users SET otp_hash=NULL,otp_expires_at=NULL WHERE id=$1`,[u.id]);
    res.cookie("token",sign(u),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*864e5});
    res.json({user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role,points:Number(u.points)}});
  }catch(e){console.error(e);res.status(500).json({error:"OTP verification failed"});}
});

app.post("/api/auth/login", async (req,res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query(`SELECT * FROM users WHERE email=$1`, [String(email||"").toLowerCase().trim()]);
    if (!r.rows[0] || !(await bcrypt.compare(password||"", r.rows[0].password_hash)))
      return res.status(401).json({error:"Invalid email or password"});
    const u=r.rows[0];
    res.cookie("token", sign(u), { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", maxAge:7*864e5 });
    res.json({ user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role,points:Number(u.points)} });
  } catch(e){ console.error(e); res.status(500).json({error:"Login failed"}); }
});
app.post("/api/auth/logout",(req,res)=>{res.clearCookie("token");res.json({ok:true});});
app.get("/api/me",auth,async(req,res)=>{
  const r=await pool.query(`SELECT id,name,email,phone,role,points FROM users WHERE id=$1`,[req.user.id]);
  res.json({user:r.rows[0]});
});

app.get("/api/markets", async(req,res)=>{
  const r=await pool.query(`SELECT * FROM markets ORDER BY closes_at ASC`);
  res.json({markets:r.rows.map(marketView)});
});

app.get("/api/predictions",auth,async(req,res)=>{
  const r=await pool.query(`
    SELECT p.*, m.title FROM predictions p JOIN markets m ON m.id=p.market_id
    WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`,[req.user.id]);
  res.json({predictions:r.rows.map(x=>({...x,stake:Number(x.stake),reward:Number(x.reward)}))});
});

app.post("/api/predictions",auth,async(req,res)=>{
  const client=await pool.connect();
  try{
    const {marketId,side,stake}=req.body;
    const amount=Number(stake);
    if(!Number.isInteger(amount)||amount<1||amount>1000000||!["YES","NO"].includes(side))
      return res.status(400).json({error:"Invalid prediction"});
    await client.query("BEGIN");
    const m=(await client.query(`SELECT * FROM markets WHERE id=$1 FOR UPDATE`,[marketId])).rows[0];
    if(!m || m.status!=="open" || new Date(m.closes_at)<=new Date()) throw new Error("Market is closed");
    const u=(await client.query(`SELECT points FROM users WHERE id=$1 FOR UPDATE`,[req.user.id])).rows[0];
    if(Number(u.points)<amount) throw new Error("Not enough virtual points");
    await client.query(`UPDATE users SET points=points-$1 WHERE id=$2`,[amount,req.user.id]);
    const p=(await client.query(`
      INSERT INTO predictions(user_id,market_id,side,stake)
      VALUES($1,$2,$3,$4) RETURNING *`,[req.user.id,marketId,side,amount])).rows[0];
    await client.query(`UPDATE markets SET ${side==="YES"?"yes_count":"no_count"}=${side==="YES"?"yes_count":"no_count"}+1 WHERE id=$1`,[marketId]);
    await client.query(`INSERT INTO point_ledger(user_id,prediction_id,amount,type,note) VALUES($1,$2,$3,'stake','Virtual points committed')`,
      [req.user.id,p.id,-amount]);
    await client.query("COMMIT");
    io.emit("market:update");
    res.json({prediction:p});
  }catch(e){await client.query("ROLLBACK");res.status(400).json({error:e.message});}
  finally{client.release();}
});

app.get("/api/leaderboard",async(req,res)=>{
  const r=await pool.query(`SELECT name,points FROM users ORDER BY points DESC LIMIT 50`);
  res.json({leaderboard:r.rows.map(x=>({name:x.name,points:Number(x.points)}))});
});

app.post("/api/admin/markets",auth,admin,async(req,res)=>{
  const {title,description,closesAt}=req.body;
  if(!title||!closesAt)return res.status(400).json({error:"Title and close time required"});
  const r=await pool.query(`INSERT INTO markets(title,description,closes_at) VALUES($1,$2,$3) RETURNING *`,
    [title,description||"",closesAt]);
  io.emit("market:update"); res.json({market:marketView(r.rows[0])});
});

app.patch("/api/admin/markets/:id",auth,admin,async(req,res)=>{
  const {status,result,title,description,closesAt}=req.body;
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const m=(await client.query(`SELECT * FROM markets WHERE id=$1 FOR UPDATE`,[req.params.id])).rows[0];
    if(!m)throw new Error("Market not found");
    if(title!==undefined)await client.query(`UPDATE markets SET title=$1 WHERE id=$2`,[title,m.id]);
    if(description!==undefined)await client.query(`UPDATE markets SET description=$1 WHERE id=$2`,[description,m.id]);
    if(closesAt!==undefined)await client.query(`UPDATE markets SET closes_at=$1 WHERE id=$2`,[closesAt,m.id]);
    if(status==="closed")await client.query(`UPDATE markets SET status='closed' WHERE id=$1`,[m.id]);
    if(result && ["YES","NO"].includes(result)){
      await client.query(`UPDATE markets SET result=$1,status='resolved' WHERE id=$2`,[result,m.id]);
      const ps=(await client.query(`SELECT * FROM predictions WHERE market_id=$1 AND status='pending' FOR UPDATE`,[m.id])).rows;
      for(const p of ps){
        if(p.side===result){
          // Virtual reward: winner receives stake + 90% bonus, integer points.
          const reward=Math.floor(Number(p.stake)*1.9);
          await client.query(`UPDATE predictions SET status='won',reward=$1,resolved_at=NOW() WHERE id=$2`,[reward,p.id]);
          await client.query(`UPDATE users SET points=points+$1 WHERE id=$2`,[reward,p.user_id]);
          await client.query(`INSERT INTO point_ledger(user_id,prediction_id,amount,type,note) VALUES($1,$2,$3,'reward','Virtual points result reward')`,
            [p.user_id,p.id,reward]);
        }else{
          await client.query(`UPDATE predictions SET status='lost',resolved_at=NOW() WHERE id=$1`,[p.id]);
        }
      }
    }
    await client.query("COMMIT"); io.emit("market:update");
    res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");res.status(400).json({error:e.message});}
  finally{client.release();}
});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));

io.on("connection", socket=>socket.emit("ready",{ok:true}));

async function setupRedis(){
  if(!process.env.REDIS_URL)return;
  try{
    const pub=createClient({url:process.env.REDIS_URL}), sub=pub.duplicate();
    await Promise.all([pub.connect(),sub.connect()]);
    io.adapter(createAdapter(pub,sub));
    console.log("Redis Socket.IO adapter enabled");
  }catch(e){console.error("Redis disabled:",e.message);}
}

async function autoClose(){
  try{
    await pool.query(`UPDATE markets SET status='closed' WHERE status='open' AND closes_at<=NOW()`);
    io.emit("market:update");
  }catch(e){console.error("autoClose",e.message);}
}

const PORT=Number(process.env.PORT||3000);
(async()=>{await ensureSchema();await setupRedis();server.listen(PORT,()=>console.log(`YES/NO Pro running on http://localhost:${PORT}`));setInterval(autoClose,15000);})();
