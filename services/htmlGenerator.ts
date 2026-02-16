import { type QuestionPaperData, type Question, QuestionType } from '../types';

const escapeHtml = (unsafe: string | undefined): string => {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const formatText = (text: string = ''): string => {
    // Preserve LaTeX while cleaning redundant spacing
    return text.trim().replace(/\n/g, '<br/>').replace(/\s{2,}/g, ' ');
};

const renderOptions = (question: Question): string => {
    if (question.type === QuestionType.MultipleChoice && Array.isArray(question.options)) {
        const options = question.options as string[];
        // Options on separate lines to avoid horizontal overlap in PDF
        return `<div style="margin-top: 10px; display: flex; flex-direction: column; gap: 4px; font-size: 1em; line-height: 1.5;">
            ${options.map((opt, i) => `<div style="break-inside: avoid;">(${String.fromCharCode(97 + i)}) ${formatText(opt)}</div>`).join('')}
        </div>`;
    } else if (question.type === QuestionType.MatchTheFollowing) {
        let colA: string[] = [];
        let colB: string[] = [];
        const opts = question.options as any;
        if (opts && typeof opts === 'object') {
            colA = opts.columnA || [];
            colB = opts.columnB || [];
        }
        if (colA.length === 0) return '';
        const rows = colA.map((item, index) => `
            <tr>
                <td style="padding: 6px 10px; border: 1px solid #000; width: 50%; font-size: 0.95em; vertical-align: top;">(${index + 1}) ${formatText(item)}</td>
                <td style="padding: 6px 10px; border: 1px solid #000; width: 50%; font-size: 0.95em; vertical-align: top;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');
        return `<table style="width: 100%; border-collapse: collapse; margin-top: 15px; border: 1px solid #000; break-inside: avoid; table-layout: fixed;">
            <thead><tr style="background-color: #f8fafc;"><th style="padding: 8px; border: 1px solid #000; text-align: left; font-size: 0.9em;">Column A</th><th style="padding: 8px; border: 1px solid #000; text-align: left; font-size: 0.9em;">Column B</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }
    return '';
};

const renderQuestion = (question: Question, isAnswerKey: boolean): string => {
    const optionsHtml = renderOptions(question);
    const answerHtml = isAnswerKey ? `<div style="margin-top: 8px; font-size: 0.95em; color: #3730a3; font-weight: 700; border-left: 3px solid #3730a3; padding-left: 10px;">Ans: ${formatText(typeof question.answer === 'string' ? question.answer : JSON.stringify(question.answer))}</div>` : '';
    return `<div class="question-block" style="break-inside: avoid; margin-bottom: 1.25rem; width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;">
                <div style="font-size: 1.05em; line-height: 1.5; flex: 1;">${question.questionNumber}. ${formatText(question.questionText)}</div>
                <div style="font-weight: 800; min-width: 40px; text-align: right; font-size: 1em;">[${question.marks}]</div>
            </div>
            ${optionsHtml ? `<div style="padding-left: 24px;">${optionsHtml}</div>` : ''}
            ${answerHtml ? `<div style="padding-left: 24px; margin-top: 8px;">${answerHtml}</div>` : ''}
        </div>`;
};

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' }, isAnswerKey?: boolean }): string => {
    const types = [QuestionType.MultipleChoice, QuestionType.FillInTheBlanks, QuestionType.TrueFalse, QuestionType.MatchTheFollowing, QuestionType.ShortAnswer, QuestionType.LongAnswer];
    let qCount = 0;
    let sCount = 0;
    const isKey = options?.isAnswerKey ?? false;
    let html = `<div id="paper-root" style="color: #000; background: #fff; width: 100%; line-height: 1.5; font-size: 12pt;">
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 15px;">
            <h1 style="margin: 0; font-size: 20pt; font-weight: 900; text-transform: uppercase;">${escapeHtml(paperData.schoolName)}</h1>
            <h2 style="margin: 5px 0; font-size: 14pt; font-weight: 700; text-decoration: underline;">${escapeHtml(paperData.subject)}${isKey ? ' - ANSWER KEY' : ''}</h2>
            <p style="margin: 2px 0; font-size: 12pt; font-weight: 600;">Class: ${escapeHtml(paperData.className)}</p>
            <div style="display: flex; justify-content: space-between; font-weight: 700; margin-top: 10px; border-top: 1px solid #000; padding-top: 5px;">
                <span>Time: ${escapeHtml(paperData.timeAllowed)}</span>
                <span>Max Marks: ${escapeHtml(paperData.totalMarks)}</span>
            </div>
        </div>`;
    types.forEach(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return;
        sCount++;
        html += `<div style="text-align: center; margin: 25px 0 15px; font-weight: 800; text-transform: uppercase; font-size: 1.1em; letter-spacing: 1px;">Section ${String.fromCharCode(64 + sCount)}</div>
            <div style="border-bottom: 1.5px solid #000; padding-bottom: 3px; margin-bottom: 15px; font-weight: 700; font-size: 1em;">${type} Questions</div>`;
        qs.forEach(q => { qCount++; html += renderQuestion({ ...q, questionNumber: qCount }, isKey); });
    });
    return html + `</div>`;
};