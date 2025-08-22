import type { Question } from './questionService'

type Params = { topic: string; difficulty: 'Very Easy' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard'; count: number }

export async function aiGenerateQuestions(params: Params): Promise<Omit<Question, 'id'>[]> {
  // Mocked AI generation (no backend). Pretend we call OpenAI.
  await new Promise((r) => setTimeout(r, 800))
  
  const generateMCQChoices = (topic: string, difficulty: string) => {
    const baseChoices = [
      'Correct answer for this topic',
      'Common misconception about this topic',
      'Related but incorrect concept',
      'Unrelated technical term'
    ]
    
    // Generate 4-6 choices randomly
    const choiceCount = Math.floor(Math.random() * 3) + 4 // 4, 5, or 6 choices
    const choices = []
    
    for (let i = 0; i < choiceCount; i++) {
      if (i < baseChoices.length) {
        choices.push(`[${topic}] ${baseChoices[i]} #${i + 1} (${difficulty})`)
      } else {
        // Generate additional variations
        const variations = [
          'Alternative approach to this topic',
          'Different perspective on this concept',
          'Related technology or method',
          'Historical context of this topic'
        ]
        const variationIndex = (i - baseChoices.length) % variations.length
        choices.push(`[${topic}] ${variations[variationIndex]} #${i + 1} (${difficulty})`)
      }
    }
    
    return choices
  }
  
  const samples: Omit<Question, 'id'>[] = Array.from({ length: params.count }).map((_, i) => {
    const questionType = (i % 3 === 0 ? 'MCQ' : i % 3 === 1 ? 'Short Answer' : 'Essay')
    const baseQuestion = {
      text: `[${params.topic}] Auto‑generated question #${i + 1} (${params.difficulty})`,
      answer: `[${params.topic}] Correct answer for question #${i + 1}`,
      subject: params.topic,
      difficulty: params.difficulty,
      type: questionType,
      status: 'pending' as const,
    }
    
    // Add choices for MCQ questions
    if (questionType === 'MCQ') {
      return {
        ...baseQuestion,
        choices: generateMCQChoices(params.topic, params.difficulty)
      }
    }
    
    return baseQuestion
  })
  
  return samples
}


