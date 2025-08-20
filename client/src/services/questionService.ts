export type Question = {
  id: string
  text: string
  answer: string
  subject: string
  difficulty: 'Very Easy' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard'
  type: 'MCQ' | 'Short Answer' | 'Essay'
  status: 'draft' | 'pending' | 'approved' | 'rejected'
  choices?: string[]
  tags?: string[]
  history?: Array<{
    at: string
    by: string
    from?: Question['status'] | 'new'
    to: Question['status']
    comment?: string
  }>
}

const KEY = 'ai_exam_questions'

function seedIfEmpty() {
  if (localStorage.getItem(KEY)) return
  const seeded: Question[] = [
    { id: crypto.randomUUID(), text: 'What is Big-O notation?', answer: 'Order of growth', subject: 'Algorithms', difficulty: 'Easy', type: 'Short Answer', status: 'approved' },
    { id: crypto.randomUUID(), text: 'Normalize this schema: ...', answer: 'Third normal form', subject: 'Databases', difficulty: 'Medium', type: 'Essay', status: 'approved' },
    { id: crypto.randomUUID(), text: 'What does Array.prototype.map do?', answer: 'Transforms array elements', subject: 'JavaScript', difficulty: 'Easy', type: 'MCQ', status: 'approved', choices: [
      'Transforms array elements',
      'Filters array elements',
      'Reduces array to a single value',
      'Sorts array in place'
    ] },
  ]
  localStorage.setItem(KEY, JSON.stringify(seeded))
}

export function getQuestions(): Question[] {
  seedIfEmpty()
  const raw = localStorage.getItem(KEY)
  const items: Question[] = raw ? (JSON.parse(raw) as Question[]) : []
  // Ensure a minimum set of approved Algorithm MCQs are present so they appear in Question Bank
  const approvedAlgMcqCount = items.filter(q => q.subject === 'Algorithms' && q.type === 'MCQ' && q.status === 'approved').length
  if (approvedAlgMcqCount < 3) {
    const samples: Array<Omit<Question, 'id'>> = [
      { text: 'Which algorithm has average time complexity O(n log n)?', answer: 'Merge sort', subject: 'Algorithms', difficulty: 'Medium', type: 'MCQ', status: 'approved', choices: ['Merge sort','Counting sort','Insertion sort','Bubble sort'] },
      { text: 'Which data structure operates in FIFO order?', answer: 'Queue', subject: 'Algorithms', difficulty: 'Very Easy', type: 'MCQ', status: 'approved', choices: ['Queue','Stack','Tree','Graph'] },
      { text: 'Binary search works on which type of data?', answer: 'Sorted array', subject: 'Algorithms', difficulty: 'Easy', type: 'MCQ', status: 'approved', choices: ['Sorted array','Unsorted array','Any array','Linked list only'] },
    ]
    let added = 0
    for (const s of samples) {
      if (approvedAlgMcqCount + added >= 3) break
      items.push({ id: crypto.randomUUID(), history: [{ at: new Date().toISOString(), by: 'System', from: 'new', to: s.status }], ...s })
      added++
    }
    localStorage.setItem(KEY, JSON.stringify(items))
  }
  return items
}

export function createQuestion(partial: Omit<Question, 'id'>) {
  const items = getQuestions()
  const now = new Date().toISOString()
  const next: Question = {
    id: crypto.randomUUID(),
    history: [{ at: now, by: 'System', from: 'new', to: partial.status }],
    ...partial,
  }
  items.push(next)
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function removeQuestion(id: string) {
  const items = getQuestions().filter((q) => q.id !== id)
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function updateQuestionStatus(
  id: string,
  status: Question['status'],
  meta?: { comment?: string; reviewer?: string }
) {
  const now = new Date().toISOString()
  const items = getQuestions().map((q) => {
    if (q.id !== id) return q
    const history = q.history ?? []
    history.push({ at: now, by: meta?.reviewer ?? 'Reviewer', from: q.status, to: status, comment: meta?.comment })
    return { ...q, status, history }
  })
  localStorage.setItem(KEY, JSON.stringify(items))
}


