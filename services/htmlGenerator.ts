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
                        <td style="width: 50%; vertical-align: top; padding: 2px 10px 2px 0;">(a) ${formatSpecialText(options[0])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 2px 0 2px 10px;">(b) ${formatSpecialText(options[1])}</td>
                    </tr>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 2px 10px 2px 0;">(c) ${formatSpecialText(options[2])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 2px 0 2px 10px;">(d) ${formatSpecialText(options[3])}</td>
                    </tr>
                </tbody></table>`;
        }
        return `<div style="margin-top: 8px;">${options.map((opt, i) => `<div style="padding: 2px 0;">(${String.fromCharCode(97 + i)}) ${formatSpecialText(opt)}</div>`).join('')}</div>`
    } else if (question.type === QuestionType.MatchTheFollowing) {
        let colA: string[] = [];
        let colB: string[] = [];

        if (typeof question.options === 'object' && question.options && 'columnA' in (question.options as any)) {
            colA = (question.options as any).columnA || [];
            colB = (question.options as any).columnB || [];
        } else if (Array.isArray(question.options)) {
            const items = question.options as string[];
            const mid = Math.ceil(items.length / 2);
            colA = items.slice(0, mid);
            colB = items.slice(mid);
        }

        const rows = colA.map((item, index) => `
            <tr>
                <td style="padding: 8px; vertical-align: top; border: 1px solid #ddd;">(${index + 1}) ${formatSpecialText(item)}</td>
                <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">---</td>
                <td style="padding: 8px; vertical-align: top; border: 1px solid #ddd;">(${String.fromCharCode(97 + index)}) ${formatSpecialText(colB[index] || '')}</td>
            </tr>
        `).join('');

        return `<table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead><tr style="text-align: left;"><th>Column A</th><th>Link</th><th>Column B</th></tr></thead>
                <tbody>${rows}</tbody>
                </table>`;
    }
    return '';
};

const renderQuestion = (question: Question): string => {
    const optionsHtml = renderOptions(question);
    const questionText = formatSpecialText(question.questionText);
    const questionColorStyle = question.styles?.color ? `color: ${escapeHtml(question.styles.color)};` : '';
    return `<div class="question-item" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.5rem;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 30px; padding-right: 5px; font-weight: bold;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; ${questionColorStyle} line-height: 1.5;">${questionText}</td>
                        <td style="vertical-align: top; text-align: right; width: 50px; padding-left: 10px; font-weight: bold;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div class="question-options" style="padding-left: 30px;">${optionsHtml}</div>` : ''}
        </div>`;
};

const generateHeaderHtml = (paperData: QuestionPaperData, titleOverride?: string, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }) => {
    const logoSrc = options?.logoConfig?.src;
    const logoAlignment = options?.logoConfig?.alignment ?? 'center';
    let headerContentHtml = '';
    const logoImgTag = `<img src="${logoSrc}" alt="School Logo" style="max-height: 80px; margin-bottom: 10px; display: inline-block;" />`;
    const title = titleOverride || paperData.subject;
    const schoolDetails = `
        <h3 style="font-size: 20px; font-weight: 900; margin: 0; text-transform: uppercase;">${escapeHtml(paperData.schoolName)}</h3>
        <h4 style="font-size: 16px; font-weight: bold; margin: 5px 0; text-decoration: underline;">${escapeHtml(title)}</h4>
        <p style="margin: 2px 0; font-weight: bold;">Class: ${escapeHtml(paperData.className)}</p>
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
        headerContentHtml = `<div style="text-align: center;">${logoSrc && logoAlignment === 'center' ? logoImgTag : ''}${schoolDetails}</div>`;
    }
    return `<div style="break-inside: avoid; page-break-inside: avoid;">
            ${headerContentHtml}
            <hr style="border:0; border-top:2px solid #000; margin-top: 10px;">
             <table style="width:100%; margin: 5px 0;"><tbody><tr>
                <td style="text-align:left;"><b>Time Allowed: ${escapeHtml(paperData.timeAllowed)}</b></td>
                <td style="text-align:right;"><b>Total Marks: ${escapeHtml(paperData.totalMarks)}</b></td>
            </tr></tbody></table>
            <hr style="border:0; border-top:1.5px solid #000;">
        </div>`;
}

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }): string => {
    const sectionOrder = [ 
        QuestionType.MultipleChoice, 
        QuestionType.FillInTheBlanks, 
        QuestionType.TrueFalse, 
        QuestionType.MatchTheFollowing, 
        QuestionType.ShortAnswer, 
        QuestionType.LongAnswer, 
    ];
    let questionCounter = 0;
    let sectionLetterCounter = 0;
    const sectionsHtml = sectionOrder.map(sectionType => {
        const questionsInSection = paperData.questions.filter(q => q.type === sectionType);
        if (questionsInSection.length === 0) return '';
        sectionLetterCounter++;
        const sectionLetter = String.fromCharCode(64 + sectionLetterCounter);
        const sectionTotalMarks = questionsInSection.reduce((acc, q) => acc + q.marks, 0);
        const sectionHeaderHtml = `
            <div style="text-align: center; font-weight: bold; margin: 30px 0 10px; break-after: avoid; page-break-after: avoid;">
                <p style="text-decoration: underline; margin: 0;">Section ${sectionLetter}</p>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; margin-bottom: 20px; border-bottom: 1px solid #000; padding-bottom: 5px;">
                <span>${toRoman(sectionLetterCounter)}. ${sectionType}</span>
                <span>[${questionsInSection.length} &times; ${questionsInSection[0].marks} = ${sectionTotalMarks} Marks]</span>
            </div>
        `;
        const sectionQuestionsHtml = questionsInSection.map(q => {
            questionCounter++;
            return renderQuestion({ ...q, questionNumber: questionCounter });
        }).join('');
        return sectionHeaderHtml + sectionQuestionsHtml;
    }).join('');
    const headerHtml = generateHeaderHtml(paperData, undefined, options);
    return `<div style="font-family: 'Inter', 'Times New Roman', serif;">${headerHtml}${sectionsHtml}</div>`;
};
