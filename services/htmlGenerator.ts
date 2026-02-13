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

const formatText = (text: string = ''): string => {
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
        // Extremely generous line-height (2.8) specifically for math fractions
        return `<table style="width: 100%; border-collapse: collapse; margin-top: 15px; table-layout: fixed; font-family: inherit; break-inside: avoid;"><tbody>
                <tr>
                    <td style="width: 50%; vertical-align: middle; padding: 15px 10px 15px 0; font-size: 1.1em; line-height: 2.8;">(a) ${formatText(options[0])}</td>
                    <td style="width: 50%; vertical-align: middle; padding: 15px 0 15px 10px; font-size: 1.1em; line-height: 2.8;">(b) ${formatText(options[1])}</td>
                </tr>
                <tr>
                    <td style="width: 50%; vertical-align: middle; padding: 15px 10px 15px 0; font-size: 1.1em; line-height: 2.8;">(c) ${formatText(options[2])}</td>
                    <td style="width: 50%; vertical-align: middle; padding: 15px 0 15px 10px; font-size: 1.1em; line-height: 2.8;">(d) ${formatText(options[3])}</td>
                </tr>
            </tbody></table>`;
    } else if (question.type === QuestionType.MatchTheFollowing) {
        let colA: string[] = [];
        let colB: string[] = [];
        const opts = question.options as any;
        if (opts && typeof opts === 'object') {
            if ('columnA' in opts && 'columnB' in opts) {
                colA = opts.columnA || [];
                colB = opts.columnB || [];
            } else {
                colA = Object.keys(opts);
                colB = Object.values(opts) as string[];
            }
        }
        if (colA.length === 0) return '';
        
        const rows = colA.map((item, index) => `
            <tr>
                <td style="padding: 12px 15px; border: 1.5px solid #000; width: 50%; vertical-align: middle; line-height: 2.4;">(${toRoman(index + 1).toLowerCase()}) ${formatText(item)}</td>
                <td style="padding: 12px 15px; border: 1.5px solid #000; width: 50%; vertical-align: middle; line-height: 2.4;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `<table style="width: 100%; border-collapse: collapse; margin-top: 20px; border: 2.5px solid #000; background-color: #fff; break-inside: avoid; table-layout: fixed;">
                <thead>
                    <tr style="text-align: left; background-color: #f4f4f4; border-bottom: 2.5px solid #000;">
                        <th style="padding: 12px 15px; border: 1.5px solid #000; font-weight: 900; font-size: 1em; text-transform: uppercase;">Column A</th>
                        <th style="padding: 12px 15px; border: 1.5px solid #000; font-weight: 900; font-size: 1em; text-transform: uppercase;">Column B</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    return '';
};

const renderQuestion = (question: Question, isAnswerKey: boolean): string => {
    const optionsHtml = renderOptions(question);
    let answerText = '';
    if (typeof question.answer === 'object' && question.answer !== null) {
        answerText = Object.entries(question.answer).map(([key, value]) => `${key} → ${value}`).join(', ');
    } else {
        answerText = String(question.answer || '');
    }
    const answerHtml = isAnswerKey ? `
        <div style="margin-top: 15px; padding: 15px; background-color: #f1f5f9; border-left: 6px solid #4f46e5; border-radius: 4px; font-size: 1.1em; break-inside: avoid;">
            <strong style="color: #4f46e5; text-transform: uppercase; font-size: 0.9em; display: block; margin-bottom: 6px;">Official Solution:</strong>
            <div style="line-height: 2.2;">${formatText(answerText)}</div>
        </div>
    ` : '';

    return `<div class="question-block" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.6rem; width: 100%; overflow: visible;">
            <table style="width: 100%; border-collapse: collapse; break-inside: avoid;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 45px; font-weight: bold; font-size: 1.2em; line-height: 2.5;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 2.5; font-size: 1.2em; padding-right: 15px; padding-bottom: 10px;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 90px; font-weight: bold; font-size: 1.2em; line-height: 2.5;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div style="padding-left: 45px; overflow: visible;">${optionsHtml}</div>` : ''}
            ${answerHtml ? `<div style="padding-left: 45px; overflow: visible;">${answerHtml}</div>` : ''}
        </div>`;
};

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' }, isAnswerKey?: boolean }): string => {
    const sectionOrder = [QuestionType.MultipleChoice, QuestionType.FillInTheBlanks, QuestionType.TrueFalse, QuestionType.MatchTheFollowing, QuestionType.ShortAnswer, QuestionType.LongAnswer];
    let questionCounter = 0;
    let sectionCount = 0;
    const isAnswerKey = options?.isAnswerKey ?? false;
    let contentHtml = '';

    const logoSrc = options?.logoConfig?.src;
    const logoImgTag = logoSrc ? `<img src="${logoSrc}" alt="Logo" style="max-height: 90px; margin-bottom: 20px; display: inline-block;" />` : '';
    
    contentHtml += `
        <div style="text-align: center; width: 100%; margin-bottom: 30px; break-inside: avoid;">
            ${logoImgTag}
            <h1 style="margin: 0; font-size: 30px; font-weight: 900; text-transform: uppercase; color: #000; letter-spacing: 1px;">${escapeHtml(paperData.schoolName)}</h1>
            <h2 style="margin: 10px 0; font-size: 22px; text-decoration: underline; font-weight: bold; color: #000;">${escapeHtml(paperData.subject)}${isAnswerKey ? ' - ANSWER KEY' : ''}</h2>
            <p style="margin: 5px 0; font-weight: 700; font-size: 1.3em;">Class: ${escapeHtml(paperData.className)}</p>
            <hr style="border: 0; border-top: 4px solid #000; margin-top: 20px;">
            <table style="width: 100%; margin: 12px 0; font-weight: bold; font-size: 1.2em; border-collapse: collapse;">
                <tr>
                    <td style="text-align: left;">Time Allowed: ${escapeHtml(paperData.timeAllowed)}</td>
                    <td style="text-align: right;">Total Marks: ${escapeHtml(paperData.totalMarks)}</td>
                </tr>
            </table>
            <hr style="border: 0; border-top: 2px solid #000; margin-bottom: 40px;">
        </div>
    `;

    sectionOrder.forEach(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return;
        sectionCount++;
        const sectionTotal = qs.reduce((acc, q) => acc + q.marks, 0);
        contentHtml += `
            <div style="text-align: center; margin: 40px 0 20px; font-weight: 900; text-transform: uppercase; text-decoration: underline; font-size: 1.5em; break-inside: avoid;">Section ${String.fromCharCode(64 + sectionCount)}</div>
            <div style="display: flex; justify-content: space-between; border-bottom: 3.5px solid #000; padding-bottom: 8px; margin-bottom: 30px; font-weight: bold; break-inside: avoid;">
                <span style="font-size: 1.3em;">${toRoman(sectionCount)}. ${type} Questions</span>
                <span style="font-size: 1.2em;">[${qs.length} &times; ${qs[0].marks} = ${sectionTotal} Marks]</span>
            </div>
        `;
        qs.forEach(q => {
            questionCounter++;
            contentHtml += renderQuestion({ ...q, questionNumber: questionCounter }, isAnswerKey);
        });
    });

    return `<div id="paper-root" style="font-family: inherit; color: #000; background: #fff; width: 100%; min-height: 100%; box-sizing: border-box; overflow: visible;">${contentHtml}</div>`;
};