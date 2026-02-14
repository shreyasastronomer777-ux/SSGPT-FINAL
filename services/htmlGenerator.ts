
import { type QuestionPaperData, type Question, QuestionType } from '../types';

const escapeHtml = (unsafe: string | undefined): string => {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const formatSpecialText = (text: string = ''): string => {
    const escapedText = escapeHtml(text.trim());
    return escapedText.replace(/\n/g, '<br/>');
};

const toRoman = (num: number): string => {
    const roman = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
    let str = '';
    for (let i of Object.keys(roman)) {
        const romanKey = i as keyof typeof roman;
        let q = Math.floor(num / (roman[romanKey] as number));
        num -= q * (roman[romanKey] as number);
        str += i.repeat(q);
    }
    return str;
};

const renderOptions = (question: Question): string => {
    if (question.type === QuestionType.MultipleChoice && Array.isArray(question.options)) {
        const options = question.options as string[];
        if (options.length >= 4) {
            return `<table style="width: 100%; border-collapse: separate; border-spacing: 0 4px; margin-top: 8px;"><tbody>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 4px 10px 4px 0; word-wrap: break-word; white-space: normal; line-height: 1.6;">(a) ${formatSpecialText(options[0])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 4px 0 4px 10px; word-wrap: break-word; white-space: normal; line-height: 1.6;">(b) ${formatSpecialText(options[1])}</td>
                    </tr>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 4px 10px 4px 0; word-wrap: break-word; white-space: normal; line-height: 1.6;">(c) ${formatSpecialText(options[2])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 4px 0 4px 10px; word-wrap: break-word; white-space: normal; line-height: 1.6;">(d) ${formatSpecialText(options[3])}</td>
                    </tr>
                </tbody></table>`;
        }
        return `<div>${options.map((opt, i) => `<div style="padding: 4px 0; line-height: 1.6;">(${String.fromCharCode(97 + i)}) ${formatSpecialText(opt)}</div>`).join('')}</div>`
    } else if (question.type === QuestionType.MatchTheFollowing && typeof question.options === 'object' && question.options && 'columnA' in question.options && 'columnB' in question.options) {
        const { columnA, columnB } = question.options as { columnA: string[], columnB: string[] };
         if (!Array.isArray(columnA) || !Array.isArray(columnB) || columnA.length !== columnB.length) {
            return '<!-- Invalid Match The Following options data -->';
        }
        const header = `<thead>
            <tr style="background-color: #f8f8f8; font-weight: bold;">
                <th style="padding: 12px; text-align: left; width: 50%; border-right: 1px solid #cccccc; border-bottom: 1px solid #cccccc;">Column A</th>
                <th style="padding: 12px; text-align: left; width: 50%; border-bottom: 1px solid #cccccc;">Column B</th>
            </tr>
        </thead>`;

        const rows = columnA.map((item, index) => `
            <tr style="break-inside: avoid; page-break-inside: avoid;">
                <td style="padding: 12px; vertical-align: top; width: 50%; border-right: 1px solid #cccccc; border-top: 1px solid #cccccc; line-height: 1.6;">(${toRoman(index + 1).toLowerCase()}) ${formatSpecialText(item)}</td>
                <td style="padding: 12px; vertical-align: top; width: 50%; border-top: 1px solid #cccccc; line-height: 1.6;">(${String.fromCharCode(97 + index)}) ${formatSpecialText(columnB[index])}</td>
            </tr>
        `).join('');

        return `<table style="width: 100%; border-collapse: collapse; border: 1px solid #cccccc; margin-top: 1.25rem; break-inside: avoid; page-break-inside: avoid;">
            ${header}
            <tbody>${rows}</tbody>
        </table>`;
    }
    return '';
};

const renderQuestion = (question: Question): string => {
    const optionsHtml = renderOptions(question);
    const questionText = formatSpecialText(question.questionText);
    const questionColorStyle = question.styles?.color ? `color: ${escapeHtml(question.styles.color)};` : '';
    // Added margin-bottom and line-height for better spacing
    return `<div class="question-item" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.5rem;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 35px; padding-right: 5px; font-weight: 600; line-height: 1.8;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; ${questionColorStyle} word-wrap: break-word; white-space: normal; line-height: 1.8;">${questionText}</td>
                        <td style="vertical-align: top; text-align: right; width: 50px; padding-left: 10px; font-weight: 600; line-height: 1.8;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div class="question-options" style="padding-left: 40px; margin-top: 0.75rem;">${optionsHtml}</div>` : ''}
        </div>`;
};

// --- Answer Key Generation ---

const renderAnswerContent = (question: Question): string => {
    if (question.type === QuestionType.MatchTheFollowing && typeof question.answer === 'object' && question.answer !== null) {
        return `<ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
            ${Object.entries(question.answer).map(([key, value]) => `<li><b>${escapeHtml(key)}</b> &rarr; ${escapeHtml(String(value))}</li>`).join('')}
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
    
    return `<div style="font-weight: bold; color: #15803d; line-height: 1.6;">${formatSpecialText(answerText)}</div>`;
};

export const generateAnswerKeyHtml = (paperData: QuestionPaperData, showQuestions: boolean, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }): string => {
    const headerHtml = generateHeaderHtml(paperData, "ANSWER KEY", options);
    
    const questionsHtml = paperData.questions.map(q => {
        const questionBlock = showQuestions ? `
            <div style="margin-bottom: 4px; color: #334155; font-size: 0.95em; line-height: 1.6;">
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


// --- Shared Header Generator ---

const generateHeaderHtml = (paperData: QuestionPaperData, titleOverride?: string, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }) => {
     const logoSrc = options?.logoConfig?.src;
    const logoAlignment = options?.logoConfig?.alignment ?? 'center';
    let headerContentHtml = '';
    const logoImgTag = `<img src="${logoSrc}" alt="School Logo" style="max-height: 90px; margin-bottom: 10px; display: inline-block;" />`;
    const title = titleOverride || paperData.subject;
    
    const schoolDetails = `
        <h3 style="font-size: 22px; font-weight: bold; margin: 0; line-height: 1.3;">${escapeHtml(paperData.schoolName)}</h3>
        <h4 style="font-size: 18px; font-weight: bold; margin: 8px 0; text-decoration: underline; line-height: 1.3;">${escapeHtml(title)}</h4>
        <p style="margin: 6px 0; font-size: 1.1em;">Class: ${escapeHtml(paperData.className)}</p>
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
            <hr style="border:0; border-top: 2px solid #000; margin-top: 15px;">
             <table style="width:100%; margin: 10px 0; font-weight: 600; font-size: 1em;"><tbody><tr>
                <td style="text-align:left;">Time Allowed: ${escapeHtml(paperData.timeAllowed)}</td>
                <td style="text-align:right;">Max. Marks: ${escapeHtml(paperData.totalMarks)}</td>
            </tr></tbody></table>
            <hr style="border:0; border-top: 2px solid #000; margin-bottom: 20px;">
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

        const marksSummary = new Map<number, number>(); // Map<marks, count>
        let sectionTotalMarks = 0;
        questionsInSection.forEach(q => {
            marksSummary.set(q.marks, (marksSummary.get(q.marks) || 0) + 1);
            sectionTotalMarks += q.marks;
        });
        const marksSummaryString = Array.from(marksSummary.entries())
            .map(([marks, count]) => `${count} &times; ${marks}`)
            .join(', ');

        const sectionHeaderHtml = `
            <div style="text-align: center; font-weight: bold; margin: 30px 0 15px; break-after: avoid; page-break-after: avoid;">
                <p style="text-decoration: underline; margin: 0; font-size: 1.1em;">Section ${sectionLetter}</p>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; margin-bottom: 20px; break-after: avoid; page-break-after: avoid; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;">
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

    // Increase base line-height to 1.8 to prevent fraction overlap in paragraphs
    return `
        <div id="paper-root" style="font-family: 'Times New Roman', Times, serif; color: #000; background: #fff; width: 100%; min-height: 100%; box-sizing: border-box; line-height: 1.8; padding: 20px;">
            ${headerHtml}
            ${sectionsHtml}
        </div>
    `;
};
