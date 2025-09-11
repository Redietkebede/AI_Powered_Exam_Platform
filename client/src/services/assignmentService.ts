import { request } from "../lib/api";

export async function createAssignmentSvc(payload: {
  candidateIds: string[];
  questionIds: number[];
  config: any;
  schedule: any;
}) {
  return request("/assignments", {
    method: "POST",
    body: payload,
  });
}

export async function getAssignmentsSvc() {
  return request("/assignments", { method: "GET" });
}

export async function deleteAssignmentSvc(id: string) {
  return request(`/assignments/${id}`, { method: "DELETE" });
}
