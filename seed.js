require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const adminHash = await bcrypt.hash("Admin@12345", 12);
    const userHash = await bcrypt.hash("User@12345", 12);

    await pool.query(`
      INSERT INTO users (name,email,password_hash,role,points)
      VALUES
        ('Admin','admin@example.com',$1,'admin',100000),
        ('Demo User','user@example.com',$2,'user',10000)
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, userHash]);

    await pool.query(`
      INSERT INTO markets (title,description,closes_at)
      SELECT 'Will Team A win today?','Demo virtual-points market',NOW() + INTERVAL '6 hours'
      WHERE NOT EXISTS (SELECT 1 FROM markets WHERE title='Will Team A win today?')
    `);

    console.log("Seed complete.");
    console.log("Admin: admin@example.com / Admin@12345");
    console.log("User:  user@example.com / User@12345");
  } finally {
    await pool.end();
  }
})();
