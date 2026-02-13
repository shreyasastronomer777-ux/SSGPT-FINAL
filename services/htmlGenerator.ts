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

const stripNumbering = (text: string): string => {
    return text.trim()
        .replace(/^(\(?[a-zA-Z0-9]{1,3}[\.\)]\s*)+/, '')
        .replace(/^[Qq]\d+\.?\s*/, '')
        .replace(/\\n/g, ' ')
        .trim();
};

const formatText = (text: string = ''): string => {
    return stripNumbering(text).replace(/\n/g, '<br/>');
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
            return `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed;"><tbody>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 4px 10px 4px 0;">(a) ${formatText(options[0])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 4px 0 4px 10px;">(b) ${formatText(options[1])}</td>
                    </tr>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 4px 10px 4px 0;">(c) ${formatText(options[2])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 4px 0 4px 10px;">(d) ${formatText(options[3])}</td>
                    </tr>
                </tbody></table>`;
        }
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

        if (colA.length === 0) return '';

        const rows = colA.map((item, index) => `
            <tr>
                <td style="padding: 10px; vertical-align: top; border: 1px solid #000; width: 50%;">(${toRoman(index + 1).toLowerCase()}) ${formatText(item)}</td>
                <td style="padding: 10px; vertical-align: top; border: 1px solid #000; width: 50%;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; border: 1.5px solid #000;">
                <thead>
                    <tr style="text-align: left; background-color: #f8fafc; border-bottom: 1.5px solid #000;">
                        <th style="padding: 10px; border: 1px solid #000; width: 50%; font-weight: bold;">Column A</th>
                        <th style="padding: 10px; border: 1px solid #000; width: 50%; font-weight: bold;">Column B</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    return '';
};

const renderQuestion = (question: Question): string => {
    const optionsHtml = renderOptions(question);
    return `<div class="question-item" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.8rem;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 35px; font-weight: bold; font-size: 1.1em;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 1.5; font-size: 1.1em;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 60px; font-weight: bold; font-size: 1.1em;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div style="padding-left: 35px;">${optionsHtml}</div>` : ''}
        </div>`;
};

// Fix: Added optional options parameter to generateHtmlFromPaperData to match calls from App.tsx.
export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: any): string => {
    const sectionOrder = [QuestionType.MultipleChoice, QuestionType.FillInTheBlanks, QuestionType.TrueFalse, QuestionType.MatchTheFollowing, QuestionType.ShortAnswer, QuestionType.LongAnswer];
    let questionCounter = 0;
    let sectionCount = 0;

    const sections = sectionOrder.map(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return '';
        sectionCount++;
        const sectionTotal = qs.reduce((acc, q) => acc + q.marks, 0);
        
        return `
            <div style="text-align: center; margin: 30px 0 10px; font-weight: 900; text-transform: uppercase; text-decoration: underline;">Section ${String.fromCharCode(64 + sectionCount)}</div>
            <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 20px; font-weight: bold;">
                <span>${toRoman(sectionCount)}. ${type} Questions</span>
                <span>[${qs.length} &times; ${qs[0].marks} = ${sectionTotal} Marks]</span>
            </div>
            ${qs.map(q => { questionCounter++; return renderQuestion({ ...q, questionNumber: questionCounter }); }).join('')}
        `;
    }).join('');

    return `
        <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 26px; font-weight: 900; text-transform: uppercase;">${escapeHtml(paperData.schoolName)}</h2>
            <h3 style="margin: 5px 0; font-size: 20px; text-decoration: underline; font-weight: bold;">${escapeHtml(paperData.subject)}</h3>
            <p style="margin: 2px 0; font-weight: bold; font-size: 1.2em;">Class: ${escapeHtml(paperData.className)}</p>
            <hr style="border: 0; border-top: 3px solid #000; margin-top: 10px;">
            <table style="width: 100%; margin: 8px 0; font-weight: bold; font-size: 1.1em;">
                <tr>
                    <td style="text-align: left;">Time Allowed: ${escapeHtml(paperData.timeAllowed)}</td>
                    <td style="text-align: right;">Total Marks: ${escapeHtml(paperData.totalMarks)}</td>
                </tr>
            </table>
            <hr style="border: 0; border-top: 2px solid #000; margin-bottom: 20px;">
        </div>
        ${sections}
    `;
};