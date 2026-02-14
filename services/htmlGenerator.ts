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
        // Massive line-height (2.8) specifically for tall math clearance in options
        return `<table style="width: 100%; border-collapse: collapse; margin-top: 15px; table-layout: fixed; font-family: inherit; break-inside: avoid;"><tbody>
                <tr>
                    <td style="width: 50%; vertical-align: top; padding: 15px 10px 15px 0; font-size: 1.1em; line-height: 2.8;">(a) ${formatText(options[0])}</td>
                    <td style="width: 50%; vertical-align: top; padding: 15px 0 15px 10px; font-size: 1.1em; line-height: 2.8;">(b) ${formatText(options[1])}</td>
                </tr>
                <tr>
                    <td style="width: 50%; vertical-align: top; padding: 15px 10px 15px 0; font-size: 1.1em; line-height: 2.8;">(c) ${formatText(options[2])}</td>
                    <td style="width: 50%; vertical-align: top; padding: 15px 0 15px 10px; font-size: 1.1em; line-height: 2.8;">(d) ${formatText(options[3])}</td>
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
                <td style="padding: 15px 18px; border: 1.5px solid #000; width: 50%; vertical-align: middle; line-height: 2.2;">(${toRoman(index + 1).toLowerCase()}) ${formatText(item)}</td>
                <td style="padding: 15px 18px; border: 1.5px solid #000; width: 50%; vertical-align: middle; line-height: 2.2;">${colB[index] ? `(${String.fromCharCode(97 + index)}) ${formatText(colB[index])}` : ''}</td>
            </tr>
        `).join('');

        return `<table style="width: 100%; border-collapse: collapse; margin-top: 20px; border: 2.5px solid #000; background-color: #fff; break-inside: avoid; table-layout: fixed;">
                <thead>
                    <tr style="text-align: left; background-color: #f3f4f6; border-bottom: 2.5px solid #000;">
                        <th style="padding: 15px 18px; border: 1.5px solid #000; font-weight: 800; text-transform: uppercase; font-size: 0.9em; letter-spacing: 0.5px;">Column A</th>
                        <th style="padding: 15px 18px; border: 1.5px solid #000; font-weight: 800; text-transform: uppercase; font-size: 0.9em; letter-spacing: 0.5px;">Column B</th>
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
        <div style="margin-top: 15px; padding: 15px; background-color: #f9fafb; border-left: 5px solid #4f46e5; border-radius: 6px; font-size: 1.1em; break-inside: avoid;">
            <strong style="color: #4f46e5; text-transform: uppercase; font-size: 0.75em; display: block; margin-bottom: 5px; letter-spacing: 1px;">Marking Scheme:</strong>
            <div style="line-height: 2.0; font-weight: 600;">${formatText(answerText)}</div>
        </div>
    ` : '';

    // Standard question block with extreme line-height (3.5) for multi-story math safety
    return `<div class="question-block" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 3.5rem; width: 100%; overflow: visible; display: block;">
            <table style="width: 100%; border-collapse: collapse; break-inside: avoid;">
                <tbody>
                    <tr>
                        <td style="vertical-align: top; width: 45px; font-weight: 700; font-size: 1.25em; line-height: 3.5;">${question.questionNumber}.</td>
                        <td style="vertical-align: top; text-align: left; line-height: 3.5; font-size: 1.25em; padding-right: 15px; padding-bottom: 12px;">${formatText(question.questionText)}</td>
                        <td style="vertical-align: top; text-align: right; width: 95px; font-weight: 700; font-size: 1.25em; line-height: 3.5;">[${question.marks} M]</td>
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
    const logoImgTag = logoSrc ? `<div style="text-align: center;"><img src="${logoSrc}" alt="Logo" style="max-height: 100px; margin-bottom: 25px; display: inline-block;" /></div>` : '';
    
    contentHtml += `
        <div style="text-align: center; width: 100%; margin-bottom: 45px; break-inside: avoid;">
            ${logoImgTag}
            <h1 style="margin: 0; font-size: 36px; font-weight: 900; text-transform: uppercase; color: #000; letter-spacing: 2px; line-height: 1.2;">${escapeHtml(paperData.schoolName)}</h1>
            <h2 style="margin: 15px 0; font-size: 28px; text-decoration: underline; font-weight: 800; color: #000;">${escapeHtml(paperData.subject)}${isAnswerKey ? ' - SOLUTIONS' : ''}</h2>
            <p style="margin: 10px 0; font-weight: 700; font-size: 1.5em;">Grade: ${escapeHtml(paperData.className)}</p>
            <hr style="border: 0; border-top: 4px solid #000; margin-top: 25px;">
            <table style="width: 100%; margin: 15px 0; font-weight: 800; font-size: 1.4em; border-collapse: collapse;">
                <tr>
                    <td style="text-align: left;">Time: ${escapeHtml(paperData.timeAllowed)}</td>
                    <td style="text-align: right;">Total Marks: ${escapeHtml(paperData.totalMarks)}</td>
                </tr>
            </table>
            <hr style="border: 0; border-top: 3px solid #000; margin-bottom: 60px;">
        </div>
    `;

    sectionOrder.forEach(type => {
        const qs = paperData.questions.filter(q => q.type === type);
        if (qs.length === 0) return;
        sectionCount++;
        const sectionTotal = qs.reduce((acc, q) => acc + q.marks, 0);
        contentHtml += `
            <div style="text-align: center; margin: 60px 0 35px; font-weight: 800; text-transform: uppercase; text-decoration: underline; font-size: 2.0em; break-inside: avoid;">Section ${String.fromCharCode(64 + sectionCount)}</div>
            <div style="display: flex; justify-content: space-between; border-bottom: 4px solid #000; padding-bottom: 10px; margin-bottom: 45px; font-weight: 800; break-inside: avoid;">
                <span style="font-size: 1.5em;">${toRoman(sectionCount)}. ${type} Questions</span>
                <span style="font-size: 1.4em;">[${qs.length} &times; ${qs[0].marks} = ${sectionTotal} Marks]</span>
            </div>
        `;
        qs.forEach(q => {
            questionCounter++;
            contentHtml += renderQuestion({ ...q, questionNumber: questionCounter }, isAnswerKey);
        });
    });

    return `<div id="paper-root" style="font-family: 'Times New Roman', Times, serif; color: #000; background: #fff; width: 100%; min-height: 100%; box-sizing: border-box; overflow: visible;">${contentHtml}</div>`;
};