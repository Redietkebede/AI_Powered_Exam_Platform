import { Request, Response } from 'express';
import pool from '../config/db';

export async function create(req: Request, res: Response) {
  const { stem, choices, correct, tags, difficulty } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO questions (stem, choices, correct, tags, difficulty)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [stem, choices, correct, tags ?? [], difficulty]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e:any) { res.status(500).json({ error: e.message }); }
}

export async function list(_req: Request, res: Response) {
  try {
    const { rows } = await pool.query(`SELECT * FROM questions ORDER BY id DESC LIMIT 200`);
    res.json(rows);
  } catch (e:any) { res.status(500).json({ error: e.message }); }
}