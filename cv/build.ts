import ReactPDF from "@react-pdf/renderer";
import fs from 'fs';
import generatePDFFromMarkdown from './src';

const outFolder = `${__dirname}/dist`;
if (!fs.existsSync(outFolder)) fs.mkdirSync(outFolder);

const generatePDF = (name: string) => {
  const frenchMD = fs.readFileSync(`./markdown/${name}.md`);
  const frenchPDF = generatePDFFromMarkdown(frenchMD.toString());
  ReactPDF.render(frenchPDF, `${outFolder}/${name}.pdf`);
};

generatePDF("FR_LONG");
generatePDF("FR_SHORT");
// EN_SHORT.pdf is no longer generated: it is exported from Reactive Resume
// (~/MyDocuments/PERSO/career) and committed as cv/static/EN_SHORT.pdf.