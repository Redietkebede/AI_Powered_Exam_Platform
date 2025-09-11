import type { RequestHandler } from "express";

export const listAssignments: RequestHandler = async (_req, res) => {
  // TODO: fetch from DB
  res.json([]); // temporary
};

export const createAssignment: RequestHandler = async (req, res) => {
  // TODO: validate & insert into DB
  // Return a created object so FE can render it
  const created = {
    id: String(Date.now()),
    candidateIds: req.body.candidateIds ?? [],
    questionIds: req.body.questionIds ?? [],
    config: req.body.config ?? {},
    schedule: req.body.schedule ?? {},
    status: "scheduled",
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(created);
};
