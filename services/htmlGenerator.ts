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
    // Aggressive but safe removal of AI-generated prefixes. 
    // Uses lookbehind if possible, but safe regex for compatibility.
    return text.trim()
        .replace(/^(\s*(\(?[a-zA-Z0-9]{1,3}[\.\)]\s*))+/, '')
        .replace(/^[Qq]\d+[\.:\)]\s*/, '')
        .replace(/^Column\s+[AB][\.:\s]*/i, '')
        .replace(/\\n/g, ' ')
        .trim();
};

const formatText = (text: string = ''): string => {
    // Preserve Unicode characters (languages like Kannada, Hindi etc.)
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
                        <td style="width: 50%; vertical-align: top; padding: 6px 10px 6px 0;">(a) ${formatText(options[0])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 6px 0 6px 10px;">(b) ${formatText(options[1])}</td>
                    </tr>
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding: 6px 10px 6px 0;">(c) ${formatText(options[2])}</td>
                        <td style="width: 50%; vertical-align: top; padding: 6px 0 6px 10px;">(d) ${formatText(options[3])}</td>
                    </tr>
                </tbody></table>`;
        } else if (options.length > 0) {
            return `<div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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
        } else if (Array.isArray(question.options)) {
            const items = question.options as string[];
            const mid = Math.ceil(items.length / 2);
            colA = items.slice(0, mid);
            colB = items.slice(mid);
        }

        if (colA.length === 0) return '';

        const rows = colA.map((item, index) => `
            <tr>
                <td style="padding: 12px 10px; border: 1px solid #000; width: 50%; vertical-align: middle;">(${toRoman(index + 1).toLowerCase()}) ${formatText(item)}</td>
                <td style="padding: 12px 10px; border: 1px solid #000; width: 50%; vertical-align: middle;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `
            <table style="width: 100%; border-collapse: collapse; margin-top: 18px; border: 2.5px solid #000; font-size: 1.1em; background-color: #fff;">
                <thead>
                    <tr style="text-align: left; background-color: #f8fafc; border-bottom: 2.5px solid #000;">
                        <th style="padding: 12px 10px; border: 1px solid #000; width: 50%; font-weight: bold; text-transform: uppercase; font-size: 0.85em;">Column A</th>
                        <th style="padding: 12px 10px; border: 1px solid #000; width: 50%; font-weight: bold; text-transform: uppercase; font-size: 0.85em;">Column B</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    return '';
};

const renderQuestion = (question: Question): string => {
    const optionsHtml = renderOptions(question);
    return `<div class="question-item" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 2.5rem;">
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 45px; font-weight: bold; font-size: 1.2em; color: #1e293b;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 1.6; font-size: 1.2em; color: #000;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 80px; font-weight: bold; font-size: 1.15em; color: #475569;">[${question.marks}]</td>
                    </tr>
                </tbody>
            </table>
            ${optionsHtml ? `<div style="padding-left: 45px;">${optionsHtml}</div>` : ''}
        </div>`;
};

const generateHeaderHtml = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }) => {
    const logoSrc = options?.logoConfig?.src;
    const logoAlignment = options?.logoConfig?.alignment ?? 'center';
    let headerContentHtml = '';
    const logoImgTag = logoSrc ? `<img src="${logoSrc}" alt="Logo" style="max-height: 100px; margin-bottom: 15px; display: inline-block; object-fit: contain;" />` : '';
    
    const schoolDetails = `
        <h2 style="margin: 0; font-size: 32px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.75px; color: #0f172a;">${escapeHtml(paperData.schoolName)}</h2>
        <h3 style="margin: 8px 0; font-size: 24px; text-decoration: underline; font-weight: bold; color: #1e293b;">${escapeHtml(paperData.subject)}</h3>
        <p style="margin: 4px 0; font-weight: 600; font-size: 1.4em; color: #475569;">Class: ${escapeHtml(paperData.className)}</p>
    `;

    if (logoSrc && (logoAlignment === 'left' || logoAlignment === 'right')) {
        if (logoAlignment === 'left') {
            headerContentHtml = `<div style="display: flex; justify-content: space-between; align-items: center; gap: 30px;">
                <div style="flex: 0 0 auto;">${logoImgTag}</div>
                <div style="flex: 1; text-align: center;">${schoolDetails}</div>
                <div style="flex: 0 0 auto; width: 100px;"></div>
            </div>`;
        } else {
             headerContentHtml = `<div style="display: flex; justify-content: space-between; align-items: center; gap: 30px;">
                <div style="flex: 0 0 auto; width: 100px;"></div>
                <div style="flex: 1; text-align: center;">${schoolDetails}</div>
                <div style="flex: 0 0 auto;">${logoImgTag}</div>
            </div>`;
        }
    } else {
        headerContentHtml = `<div style="text-align: center;">${logoAlignment === 'center' ? logoImgTag : ''}${schoolDetails}</div>`;
    }

    return `<div style="break-inside: avoid; page-break-inside: avoid;">
            ${headerContentHtml}
            <hr style="border: 0; border-top: 4px solid #000; margin-top: 20px;">
            <table style="width: 100%; margin: 12px 0; font-weight: bold; font-size: 1.3em;">
                <tr>
                    <td style="text-align: left; color: #000;">Time Allowed: ${escapeHtml(paperData.timeAllowed)}</td>
                    <td style="text-align: right; color: #000;">Total Marks: ${escapeHtml(paperData.totalMarks)}</td>
                </tr>
            </table>
            <hr style="border: 0; border-top: 3px solid #000; margin-bottom: 35px;">
        </div>`;
}

export const generateHtmlFromPaperData = (paperData: QuestionPaperData, options?: { logoConfig?: { src?: string; alignment: 'left' | 'center' | 'right' } }): string => {
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

    const sections = sectionOrder.map(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return '';
        sectionCount++;
        const sectionTotal = qs.reduce((acc, q) => acc + q.marks, 0);
        
        return `
            <div style="text-align: center; margin: 50px 0 20px; font-weight: 900; text-transform: uppercase; text-decoration: underline; font-size: 1.5em; color: #000;">Section ${String.fromCharCode(64 + sectionCount)}</div>
            <div style="display: flex; justify-content: space-between; border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 32px; font-weight: bold;">
                <span style="font-size: 1.35em;">${toRoman(sectionCount)}. ${type} Questions</span>
                <span style="font-size: 1.25em;">[${qs.length} &times; ${qs[0].marks} = ${sectionTotal} Marks]</span>
            </div>
            ${qs.map(q => { questionCounter++; return renderQuestion({ ...q, questionNumber: questionCounter }); }).join('')}
        `;
    }).join('');

    const headerHtml = generateHeaderHtml(paperData, options);
    return `<div style="font-family: 'Inter', 'Times New Roman', serif; color: #000; background: #fff;">${headerHtml}${sections}</div>`;
};