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

const stripLeadingNumbering = (text: string): string => {
    // Aggressively remove patterns like "1. ", "1) ", "(i) ", "Q1. " at the start
    return text.trim().replace(/^(\(?[a-zA-Z0-9]{1,3}[\.\)]\s*)+/, '').trim();
};

const formatText = (text: string = ''): string => {
    return stripLeadingNumbering(text).replace(/\n/g, '<br/>');
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
            return `<table style="width: 100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed;"><tbody>
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
    }
    return '';
};

const renderQuestion = (question: Question): string => {
    const optionsHtml = renderOptions(question);
    return `<div class="question-item" style="break-inside: avoid; margin-bottom: 1.8rem; font-size: 1.1em;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 35px; font-weight: bold;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 1.6;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 60px; font-weight: bold;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div style="padding-left: 35px;">${optionsHtml}</div>` : ''}
        </div>`;
};

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: any): string => {
    const sectionTypes = [QuestionType.MultipleChoice, QuestionType.FillInTheBlanks, QuestionType.TrueFalse, QuestionType.MatchTheFollowing, QuestionType.ShortAnswer, QuestionType.LongAnswer];
    let questionCounter = 0;
    let sectionCount = 0;

    const sections = sectionTypes.map(type => {
        const questions = paperData.questions.filter(q => q.type === type);
        if (questions.length === 0) return '';
        sectionCount++;
        const sectionMarks = questions.reduce((a, b) => a + b.marks, 0);
        
        return `
            <div style="text-align: center; margin: 35px 0 15px; font-weight: bold;">
                <span style="text-decoration: underline; font-size: 1.25em; text-transform: uppercase;">Section ${String.fromCharCode(64 + sectionCount)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 25px; font-weight: bold;">
                <span>${toRoman(sectionCount)}. ${type} Questions</span>
                <span>[${questions.length} &times; ${questions[0].marks} = ${sectionMarks} Marks]</span>
            </div>
            ${questions.map(q => { questionCounter++; return renderQuestion({ ...q, questionNumber: questionCounter }); }).join('')}
        `;
    }).join('');

    return `
        <div style="text-align: center;">
            <h2 style="margin: 0; font-size: 24px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px;">${escapeHtml(paperData.schoolName)}</h2>
            <h3 style="margin: 8px 0; font-size: 18px; text-decoration: underline;">${escapeHtml(paperData.subject)}</h3>
            <p style="margin: 4px 0; font-weight: bold; font-size: 1.1em;">Class: ${escapeHtml(paperData.className)}</p>
            <hr style="border: 0; border-top: 3px solid #000; margin-top: 15px;">
            <table style="width: 100%; margin: 8px 0; font-weight: bold;">
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
