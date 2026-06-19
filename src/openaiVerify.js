const verificationSchema = {
  type: 'object',
  properties: {
    document_present: {
      type: 'boolean',
      description: 'Whether a resident registration card or student ID is visible.'
    },
    document_type: {
      type: 'string',
      enum: ['resident_registration_card', 'student_card', 'other_id_card', 'unknown'],
      description: 'The visible document type without reading or outputting private details.'
    },
    student_school_level: {
      type: 'string',
      enum: ['high_school', 'middle_school', 'university_or_college', 'other', 'unknown', 'not_student_id'],
      description: 'For student IDs only, whether the card indicates a high school student. Do not output a school name.'
    },
    verification_path: {
      type: 'string',
      enum: ['resident_registration_highpass', 'high_school_student', 'not_eligible', 'unknown'],
      description: 'Resident registration card is high-pass eligible; student ID is eligible only when it indicates high school.'
    },
    required_phrase_present: {
      type: 'boolean',
      description: 'Whether the required phrase is visible on a separate paper or note.'
    },
    required_phrase_text_matches: {
      type: 'boolean',
      description: 'Whether the visible phrase exactly matches the required phrase.'
    },
    document_and_note_same_photo: {
      type: 'boolean',
      description: 'Whether the document and phrase note appear together in the same photo.'
    },
    suspected_tampering: {
      type: 'boolean',
      description: 'Whether there are obvious signs of digital editing, screenshot reuse, or mismatch.'
    },
    confidence: {
      type: 'number',
      description: 'Confidence from 0 to 1.'
    },
    reason: {
      type: 'string',
      description: 'Short Korean explanation without names, numbers, addresses, birth dates, or school IDs.'
    }
  },
  required: [
    'document_present',
    'document_type',
    'student_school_level',
    'verification_path',
    'required_phrase_present',
    'required_phrase_text_matches',
    'document_and_note_same_photo',
    'suspected_tampering',
    'confidence',
    'reason'
  ],
  additionalProperties: false
};

function parseVerificationOutput(outputText) {
  if (!outputText) {
    throw new Error('OpenAI response did not include output text.');
  }

  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error('OpenAI response was not valid JSON.');
  }
}

export async function analyzeVerificationImage(openai, { dataUrl, model, requiredPhrase }) {
  const prompt = [
    'You are reviewing a Discord verification photo.',
    'Only determine whether the photo satisfies these criteria:',
    '1. A Korean resident registration card (주민등록증) OR a student ID card is visible.',
    `2. A separate paper/note with the exact Korean phrase "${requiredPhrase}" is visible.`,
    '3. The document and the note are in the same photo.',
    '4. There are no obvious signs of tampering, screenshots, or digital overlays.',
    '',
    'Eligibility rules:',
    '- If the document is a Korean resident registration card (주민등록증), set document_type to "resident_registration_card" and verification_path to "resident_registration_highpass". Do not inspect or output age or ID number.',
    '- If the document is a student ID, set document_type to "student_card" and decide only whether it indicates a high school student.',
    '- For a student ID, set student_school_level to "high_school" only when visible text clearly indicates high school, such as 고등학교, 고교, or High School.',
    '- If a student ID clearly indicates high school, set verification_path to "high_school_student".',
    '- Do not output the school name. If the school level is unclear, use "unknown".',
    '- Student IDs are eligible only when student_school_level is "high_school"; otherwise verification_path must be "not_eligible" or "unknown".',
    '',
    'Privacy rules:',
    '- Do not transcribe, output, or infer names, birth dates, addresses, resident numbers, student numbers, school names, genders, ages, nationality, or any unique ID data.',
    '- Do not identify a person. Do not compare faces. Do not infer religion or other sensitive traits.',
    '- If private text is visible, ignore it except for deciding document type and the required phrase.',
    '- Return only the requested JSON schema. The reason must be short Korean and must not include private details.'
  ].join('\n');

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          {
            type: 'input_image',
            image_url: dataUrl,
            detail: 'high'
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'discord_identity_verification',
        schema: verificationSchema,
        strict: true
      }
    }
  });

  return parseVerificationOutput(response.output_text);
}

export function isVerificationApproved(result, minConfidence) {
  const residentRegistrationHighpass =
    result.document_type === 'resident_registration_card' &&
    result.verification_path === 'resident_registration_highpass';
  const highSchoolStudent =
    result.document_type === 'student_card' &&
    result.student_school_level === 'high_school' &&
    result.verification_path === 'high_school_student';

  return (
    result.document_present === true &&
    (residentRegistrationHighpass || highSchoolStudent) &&
    result.required_phrase_present === true &&
    result.required_phrase_text_matches === true &&
    result.document_and_note_same_photo === true &&
    result.suspected_tampering === false &&
    Number(result.confidence) >= minConfidence
  );
}

export function getVerificationApprovalLabel(result) {
  if (result.document_type === 'resident_registration_card') {
    return '주민등록증 하이패스';
  }

  if (result.document_type === 'student_card' && result.student_school_level === 'high_school') {
    return '고등학생 학생증 확인';
  }

  return '인증 확인';
}
