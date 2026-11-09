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
// The site's CV link points to the public Reactive Resume page
// (~/MyDocuments/PERSO/career, cv-staff-architect-en); no PDF is published here.