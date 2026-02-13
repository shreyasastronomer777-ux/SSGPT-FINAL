import { type QuestionPaperData, type Question, QuestionType } from '../types';

const escapeHtml = (unsafe: string | undefined): string => {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const formatSpecialText = (text: string = ''): string => {
    // Preserve backslashes for LaTeX and newlines for spacing
    return text.trim().replace(/\n/g, '<br/>');
};

const toRoman = (num: number): string => {
    const roman = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
    let str = '';
    for (let i of Object.keys(roman)) {
        const romanKey = i as keyof typeof roman;
        let q = Math.floor(num / roman[romanKey]);
        num -= q * roman[romanKey];
        str += i.repeat(q);
    }
    return str;
};

const renderOptions = (question: Question): string => {
    if (question.type === QuestionType.MultipleChoice && Array.isArray(question.options)) {
        const options = question.options as string[];
        if (options.length >= 4) {
            return `<table style="width: 100%; border-collapse: collapse; margin-top: 8px;"><tbody>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 2px 10px 2px 0; word-wrap: break-word; white-space: normal;">(a) ${formatSpecialText(options[0])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 2px 0 2px 10px; word-wrap: break-word; white-space: normal;">(b) ${formatSpecialText(options[1])}</td>
                    </tr>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 2px 10px 2px 0; word-wrap: break-word; white-space: normal;">(c) ${formatSpecialText(options[2])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 2px 0 2px 10px; word-wrap: break-word; white-space: normal;">(d) ${formatSpecialText(options[3])}</td>
                    </tr>
                </tbody></table>`;
        }
        return `<div style="margin-top: 8px;">${options.map((opt, i) => `<div style="padding: 2px 0;">(${String.fromCharCode(97 + i)}) ${formatSpecialText(opt)}</div>`).join('')}</div>`
    } else if (question.type === QuestionType.MatchTheFollowing) {
        let colA: string[] = [];
        let colB: string[] = [];

        // Handle both structured object and array-of-strings structure (standard AI output)
        if (typeof question.options === 'object' && question.options && 'columnA' in question.options && 'columnB' in question.options) {
            colA = (question.options as any).columnA;
            colB = (question.options as any).columnB;
        } else if (Array.isArray(question.options)) {
            const items = question.options as string[];
            const mid = Math.ceil(items.length / 2);
            colA = items.slice(0, mid);
            colB = items.slice(mid);
        }

        if (colA.length === 0) return '';

        const rows = colA.map((item, index) => `
            <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td style="padding: 6px 10px 6px 0; vertical-align: top; width: 50%; border-bottom: 0.5px solid #eee;">(${toRoman(index + 1).toLowerCase()}) ${formatSpecialText(item)}</td>
                <td style="padding: 6px 0 6px 10px; vertical-align: top; width: 50%; border-bottom: 0.5px solid #eee;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatSpecialText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `
            <table style="width: 100%; border-collapse: collapse; margin-top: 12px; border: none; font-size: 0.95em;">
                <thead>
                    <tr style="text-align: left; font-weight: bold; border-bottom: 1.5px solid #000;">
                        <th style="padding: 4px 10px 8px 0; width: 50%;">Column A</th>
                        <th style="padding: 4px 0 8px 10px; width: 50%;">Column B</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    return '';
};

const renderQuestion = (question: Question): string => {
    const optionsHtml = renderOptions(question);
    const questionText = formatSpecialText(question.questionText);
    const questionColorStyle = question.styles?.color ? `color: ${escapeHtml(question.styles.color)};` : '';
    return `<div class="question-item" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.25rem;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 30px; padding-right: 5px;"><b>${question.questionNumber}.</b></td>
                        <td style="vertical-align: top; text-align: left; ${questionColorStyle} word-wrap: break-word; white-space: normal;">${questionText}</td>
                        <td style="vertical-align: top; text-align: right; width: 40px; padding-left: 10px;"><b>[${question.marks}]</b></td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div class="question-options" style="padding-left: 30px;">${optionsHtml}</div>` : ''}
        </div>`;
};

const renderAnswerContent = (question: Question): string => {
    if (question.type === QuestionType.MatchTheFollowing && typeof question.answer === 'object' && question.answer !== null) {
        return `<ul style="margin: 0; padding-left: 20px;">
            ${Object.entries(question.answer).map(([key, value]) => `<li><b>${formatSpecialText(key)}</b> &rarr; ${formatSpecialText(String(value))}</li>`).join('')}
        </ul>`;
    }
    
    let answerText = 'Not provided';
    if (question.answer !== null && question.answer !== undefined) {
        if (typeof question.answer === 'string' && question.answer.trim() !== '') {
             answerText = question.answer;
        } else {
             answerText = String(question.answer);
        }
    }
    
    return `<div style="font-weight: bold; color: #15803d;">${formatSpecialText(answerText)}</div>`;
};

export const generateAnswerKeyHtml = (paperData: QuestionPaperData, showQuestions: boolean, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }): string => {
    const headerHtml = generateHeaderHtml(paperData, "ANSWER KEY", options);
    
    const questionsHtml = paperData.questions.map(q => {
        const questionBlock = showQuestions ? `
            <div style="margin-bottom: 4px; color: #334155; font-size: 0.95em;">
                <b>Q${q.questionNumber}.</b> ${formatSpecialText(q.questionText)}
            </div>
        ` : `
            <div style="margin-bottom: 4px; color: #334155; font-size: 0.95em;">
               <b>Q${q.questionNumber}</b>
            </div>
        `;

        const answerBlock = `
            <div style="margin-left: ${showQuestions ? '20px' : '0px'};">
                ${renderAnswerContent(q)}
            </div>
        `;

        return `
            <div style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 16px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 12px;">
                ${questionBlock}
                ${answerBlock}
            </div>
        `;
    }).join('');

    return `<div>${headerHtml}<div style="margin-top: 20px;">${questionsHtml}</div></div>`;
};

const generateHeaderHtml = (paperData: QuestionPaperData, titleOverride?: string, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }) => {
     const logoSrc = options?.logoConfig?.src;
    const logoAlignment = options?.logoConfig?.alignment ?? 'center';
    let headerContentHtml = '';
    const logoImgTag = `<img src="${logoSrc}" alt="School Logo" style="max-height: 80px; margin-bottom: 10px; display: inline-block;" />`;
    const title = titleOverride || paperData.subject;
    
    const schoolDetails = `
        <h3 style="font-size: 18px; font-weight: bold; margin: 0;">${escapeHtml(paperData.schoolName)}</h3>
        <h4 style="font-size: 16px; font-weight: bold; margin: 5px 0; text-decoration: underline;">${escapeHtml(title)}</h4>
        <p style="margin: 4px 0;">Class: ${escapeHtml(paperData.className)}</p>
    `;

    if (logoSrc && (logoAlignment === 'left' || logoAlignment === 'right')) {
        if (logoAlignment === 'left') {
            headerContentHtml = `<div style="display: flex; justify-content: space-between; align-items: center; text-align: center;">
                <div style="flex: 1; text-align: left;">${logoImgTag}</div>
                <div style="flex: 2;">${schoolDetails}</div>
                <div style="flex: 1;"></div>
            </div>`;
        } else {
             headerContentHtml = `<div style="display: flex; justify-content: space-between; align-items: center; text-align: center;">
                <div style="flex: 1;"></div>
                <div style="flex: 2;">${schoolDetails}</div>
                <div style="flex: 1; text-align: right;">${logoImgTag}</div>
            </div>`;
        }
    } else {
        headerContentHtml = `<div style="text-align: center;">
                ${logoSrc && logoAlignment === 'center' ? logoImgTag : ''}
                ${schoolDetails}
            </div>`;
    }
    
    return `
        <div style="break-inside: avoid; page-break-inside: avoid;">
            ${headerContentHtml}
            <hr style="border:0; border-top:1px solid #000; margin-top: 8px;">
             <table style="width:100%; margin: 8px 0;"><tbody><tr>
                <td style="text-align:left;"><b>Time Allowed: ${escapeHtml(paperData.timeAllowed)}</b></td>
                <td style="text-align:right;"><b>Total Marks: ${escapeHtml(paperData.totalMarks)}</b></td>
            </tr></tbody></table>
            <hr style="border:0; border-top:0.5px solid #000;">
        </div>
    `;
}

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }): string => {
    const sectionOrder = [ QuestionType.MultipleChoice, QuestionType.FillInTheBlanks, QuestionType.TrueFalse, QuestionType.MatchTheFollowing, QuestionType.ShortAnswer, QuestionType.LongAnswer, ];
    let questionCounter = 0;
    let sectionLetterCounter = 0;
    const sectionsHtml = sectionOrder.map(sectionType => {
        const questionsInSection = paperData.questions.filter(q => q.type === sectionType);
        if (questionsInSection.length === 0) return '';
        
        sectionLetterCounter++;
        const sectionLetter = String.fromCharCode(64 + sectionLetterCounter);

        const marksSummary = new Map<number, number>();
        let sectionTotalMarks = 0;
        questionsInSection.forEach(q => {
            marksSummary.set(q.marks, (marksSummary.get(q.marks) || 0) + 1);
            sectionTotalMarks += q.marks;
        });
        const marksSummaryString = Array.from(marksSummary.entries())
            .map(([marks, count]) => `${count} &times; ${marks}`)
            .join(', ');

        const sectionHeaderHtml = `
            <div style="text-align: center; font-weight: bold; margin: 24px 0 8px; break-after: avoid; page-break-after: avoid;">
                <p style="text-decoration: underline; margin: 0;">Section ${sectionLetter}</p>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; margin-bottom: 16px; break-after: avoid; page-break-after: avoid;">
                <span>${toRoman(sectionLetterCounter)}. ${sectionType}</span>
                <span>[${marksSummaryString} = ${sectionTotalMarks} Marks]</span>
            </div>
        `;

        const sectionQuestionsHtml = questionsInSection.map(q => {
            questionCounter++;
            return renderQuestion({ ...q, questionNumber: questionCounter });
        }).join('');
        return sectionHeaderHtml + sectionQuestionsHtml;
    }).join('');
    
    const headerHtml = generateHeaderHtml(paperData, undefined, options);

    return `
        <div>
            ${headerHtml}
            ${sectionsHtml}
        </div>
    `;
};