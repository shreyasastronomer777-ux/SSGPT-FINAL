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
    const roman = { M: 1000, CM: 900, d: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
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
        return `<table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px; font-family: inherit; break-inside: avoid;"><tbody>
                <tr>
                    <td style="width: 50%; vertical-align: top; padding: 6px 4px; font-size: 1em; line-height: 1.6;">(a) ${formatText(options[0])}</td>
                    <td style="width: 50%; vertical-align: top; padding: 6px 4px; font-size: 1em; line-height: 1.6;">(b) ${formatText(options[1])}</td>
                </tr>
                <tr>
                    <td style="width: 50%; vertical-align: top; padding: 6px 4px; font-size: 1em; line-height: 1.6;">(c) ${formatText(options[2])}</td>
                    <td style="width: 50%; vertical-align: top; padding: 6px 4px; font-size: 1em; line-height: 1.6;">(d) ${formatText(options[3])}</td>
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
                <td style="padding: 10px 12px; border: 1px solid #000; width: 50%; vertical-align: middle; line-height: 1.6;">(${toRoman(index + 1).toLowerCase()}) ${formatText(item)}</td>
                <td style="padding: 10px 12px; border: 1px solid #000; width: 50%; vertical-align: middle; line-height: 1.6;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `<table style="width: 100%; border-collapse: collapse; margin-top: 16px; border: 1px solid #000; background-color: transparent; break-inside: avoid;">
                <thead>
                    <tr style="text-align: left; background-color: #f9fafb; border-bottom: 1px solid #000;">
                        <th style="padding: 8px 12px; border: 1px solid #000; font-weight: 700; font-size: 0.95em;">Column A</th>
                        <th style="padding: 8px 12px; border: 1px solid #000; font-weight: 700; font-size: 0.95em;">Column B</th>
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
        <div style="margin-top: 8px; padding: 8px 12px; background-color: #f0fdf4; border-left: 3px solid #16a34a; border-radius: 2px; font-size: 0.95em; break-inside: avoid;">
            <strong style="color: #15803d; font-size: 0.85em; text-transform: uppercase;">Answer:</strong>
            <span style="font-weight: 600; margin-left: 6px;">${formatText(answerText)}</span>
        </div>
    ` : '';

    return `<div class="question-block" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 24px; width: 100%;">
            <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 40px; font-weight: 600; font-size: 1.1em; line-height: 1.6; padding-top: 2px;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 1.6; font-size: 1.1em; padding-right: 12px; padding-top: 2px;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 70px; font-weight: 600; font-size: 1em; line-height: 1.6; padding-top: 2px;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div style="padding-left: 40px;">${optionsHtml}</div>` : ''}
            ${answerHtml ? `<div style="padding-left: 40px;">${answerHtml}</div>` : ''}
        </div>`;
};

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' }, isAnswerKey?: boolean }): string => {
    const sectionOrder = [QuestionType.MultipleChoice, QuestionType.FillInTheBlanks, QuestionType.TrueFalse, QuestionType.MatchTheFollowing, QuestionType.ShortAnswer, QuestionType.LongAnswer];
    let questionCounter = 0;
    let sectionCount = 0;
    const isAnswerKey = options?.isAnswerKey ?? false;
    let contentHtml = '';

    const logoSrc = options?.logoConfig?.src;
    const logoImgTag = logoSrc ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${logoSrc}" alt="Logo" style="max-height: 90px; display: inline-block;" /></div>` : '';
    
    // Header
    contentHtml += `
        <div style="text-align: center; width: 100%; margin-bottom: 35px; break-inside: avoid;">
            ${logoImgTag}
            <h1 style="margin: 0; font-size: 26px; font-weight: 700; text-transform: uppercase; color: #000; letter-spacing: 0.5px; line-height: 1.3;">${escapeHtml(paperData.schoolName)}</h1>
            <h2 style="margin: 10px 0; font-size: 19px; font-weight: 600; color: #111;">${escapeHtml(paperData.subject)}${isAnswerKey ? ' - ANSWER KEY' : ''}</h2>
            <p style="margin: 6px 0; font-weight: 500; font-size: 1.1em;">Class: ${escapeHtml(paperData.className)}</p>
            
            <div style="margin-top: 20px; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 10px 0;">
                <table style="width: 100%; font-weight: 600; font-size: 1em; border-collapse: collapse;">
                    <tr>
                        <td style="text-align: left;">Time: ${escapeHtml(paperData.timeAllowed)}</td>
                        <td style="text-align: right;">Max. Marks: ${escapeHtml(paperData.totalMarks)}</td>
                    </tr>
                </table>
            </div>
        </div>
    `;

    sectionOrder.forEach(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return;
        sectionCount++;
        const sectionTotal = qs.reduce((acc, q) => acc + q.marks, 0);
        contentHtml += `
            <div style="margin: 35px 0 20px; break-inside: avoid;">
                <div style="text-align: center; font-weight: 700; text-transform: uppercase; text-decoration: underline; font-size: 1.15em; margin-bottom: 12px; letter-spacing: 0.5px;">Section ${String.fromCharCode(64 + sectionCount)}</div>
                <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 1em; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 24px;">
                    <span>${type}</span>
                    <span>${qs.length} &times; ${qs[0].marks} = ${sectionTotal} Marks</span>
                </div>
            </div>
        `;
        qs.forEach(q => {
            questionCounter++;
            contentHtml += renderQuestion({ ...q, questionNumber: questionCounter }, isAnswerKey);
        });
    });

    return `<div id="paper-root" style="font-family: 'Times New Roman', Times, serif; color: #000; background: #fff; width: 100%; min-height: 100%; box-sizing: border-box; line-height: 1.6;">${contentHtml}</div>`;
};