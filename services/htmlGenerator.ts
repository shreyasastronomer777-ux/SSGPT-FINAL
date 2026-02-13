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
    // Robustly remove AI numbering prefixes across languages and character sets.
    return text.trim()
        .replace(/^(\s*(\(?[a-zA-Z0-9]{1,3}[\.\)]\s*))+/, '')
        .replace(/^[Qq]\d+[\.:\)]\s*/, '')
        .replace(/^Column\s+[AB][\.:\s]*/i, '')
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
            return `<table style="width: 100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed;"><tbody>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 8px 10px 8px 0; font-size: 1.15em;">(a) ${formatText(options[0])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 8px 0 8px 10px; font-size: 1.15em;">(b) ${formatText(options[1])}</td>
                    </tr>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 8px 10px 8px 0; font-size: 1.15em;">(c) ${formatText(options[2])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 8px 0 8px 10px; font-size: 1.15em;">(d) ${formatText(options[3])}</td>
                    </tr>
                </tbody></table>`;
        } else if (options.length > 0) {
            return `<div style="margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 1.15em;">
                ${options.map((opt, i) => `<div style="break-inside: avoid;">(${String.fromCharCode(97 + i)}) ${formatText(opt)}</div>`).join('')}
            </div>`;
        }
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
                <td style="padding: 12px; border: 1.5px solid #000; width: 50%; vertical-align: middle;">(${toRoman(index + 1).toLowerCase()}) ${formatText(item)}</td>
                <td style="padding: 12px; border: 1.5px solid #000; width: 50%; vertical-align: middle;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; border: 2.5px solid #000; font-size: 1.1em; background-color: #fff;">
                <thead>
                    <tr style="text-align: left; background-color: #f8fafc; border-bottom: 2.5px solid #000;">
                        <th style="padding: 12px; border: 1.5px solid #000; width: 50%; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Column A</th>
                        <th style="padding: 12px; border: 1.5px solid #000; width: 50%; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Column B</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    return '';
};

const renderQuestion = (question: Question, isAnswerKey: boolean): string => {
    const optionsHtml = renderOptions(question);
    const answerHtml = isAnswerKey ? `
        <div style="margin-top: 10px; padding: 12px; background-color: #f8fafc; border-left: 5px solid #4f46e5; font-size: 1.1em; border-radius: 4px;">
            <strong style="color: #4f46e5; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.5px;">Correct Answer:</strong>
            <div style="margin-top: 4px; color: #1e293b;">${formatText(typeof question.answer === 'string' ? question.answer : JSON.stringify(question.answer))}</div>
        </div>
    ` : '';

    return `<div class="question-item" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 3.2rem; width: 100%;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 45px; font-weight: bold; font-size: 1.25em; color: #000;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 1.6; font-size: 1.25em; color: #000;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 80px; font-weight: bold; font-size: 1.2em; color: #000;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div style="padding-left: 45px;">${optionsHtml}</div>` : ''}
            ${answerHtml ? `<div style="padding-left: 45px;">${answerHtml}</div>` : ''}
        </div>`;
};

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' }, isAnswerKey?: boolean }): string => {
    const sectionOrder = [
        QuestionType.MultipleChoice, 
        QuestionType.FillInTheBlanks, 
        QuestionType.TrueFalse, 
        QuestionType.MatchTheFollowing, 
        QuestionType.ShortAnswer, 
        QuestionType.LongAnswer
    ];
    let questionCounter = 0;
    let sectionCount = 0;
    const isAnswerKey = options?.isAnswerKey ?? false;

    let contentHtml = '';

    // Render Header
    const logoSrc = options?.logoConfig?.src;
    const logoAlignment = options?.logoConfig?.alignment ?? 'center';
    const logoImgTag = logoSrc ? `<img src="${logoSrc}" alt="Logo" style="max-height: 100px; margin-bottom: 25px; display: inline-block; object-fit: contain;" />` : '';
    
    contentHtml += `
        <div style="text-align: center; width: 100%; margin-bottom: 40px; break-inside: avoid;">
            ${logoAlignment === 'center' ? logoImgTag : ''}
            <h1 style="margin: 0; font-size: 36px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #000;">${escapeHtml(paperData.schoolName)}</h1>
            <h2 style="margin: 12px 0; font-size: 28px; text-decoration: underline; font-weight: bold; color: #1e293b;">${escapeHtml(paperData.subject)}${isAnswerKey ? ' - OFFICIAL MARKING SCHEME' : ''}</h2>
            <p style="margin: 6px 0; font-weight: 600; font-size: 1.5em; color: #475569;">Class: ${escapeHtml(paperData.className)}</p>
            <hr style="border: 0; border-top: 5px solid #000; margin-top: 25px;">
            <table style="width: 100%; margin: 15px 0; font-weight: bold; font-size: 1.4em;">
                <tr>
                    <td style="text-align: left; color: #000;">Time Allowed: ${escapeHtml(paperData.timeAllowed)}</td>
                    <td style="text-align: right; color: #000;">Total Marks: ${escapeHtml(paperData.totalMarks)}</td>
                </tr>
            </table>
            <hr style="border: 0; border-top: 4px solid #000; margin-bottom: 50px;">
        </div>
    `;

    sectionOrder.forEach(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return;
        sectionCount++;
        const sectionTotal = qs.reduce((acc, q) => acc + q.marks, 0);
        
        contentHtml += `
            <div style="text-align: center; margin: 70px 0 35px; font-weight: 900; text-transform: uppercase; text-decoration: underline; font-size: 1.7em; break-inside: avoid; color: #000;">Section ${String.fromCharCode(64 + sectionCount)}</div>
            <div style="display: flex; justify-content: space-between; border-bottom: 4.5px solid #000; padding-bottom: 12px; margin-bottom: 45px; font-weight: bold; break-inside: avoid;">
                <span style="font-size: 1.5em;">${toRoman(sectionCount)}. ${type} Questions</span>
                <span style="font-size: 1.4em;">[${qs.length} &times; ${qs[0].marks} = ${sectionTotal} Marks]</span>
            </div>
        `;

        qs.forEach(q => {
            questionCounter++;
            contentHtml += renderQuestion({ ...q, questionNumber: questionCounter }, isAnswerKey);
        });
    });

    return `<div id="paper-root" style="font-family: 'Inter', 'Times New Roman', serif; color: #000; background: #fff; width: 100%; padding-bottom: 50px;">${contentHtml}</div>`;
};