import { promises as fs } from "fs";
import path from "path";
import { __dirname } from "../utils/dirname.js";
import { sendEmail } from "../utils/emailSender.js";

async function addQuestion(req, res) {
  try {
    const { fullName, email } = req.body;
    const { originalname, buffer } = req.file || {
      originalname: null,
      buffer: null,
    };
    const questionsTemplate = path.join(
      __dirname,
      "../email_templates/add_feedback.html"
    );
    const htmlTemplate = await fs.readFile(questionsTemplate, "utf-8");
    const renderedHTML = htmlTemplate.replace(
      /{{\s*([^}]+)\s*}}/g,
      (_, match) =>
        req.body[match.trim()] !== undefined
          ? req.body[match.trim()]
          : `<span style="color:red; font-size:15px">No value provided</span>`
    );
    const mailOptions = {
      from: `"${fullName}" <${email}>`,
      to: "ascmulingua@gmail.com",
      subject: "FAQs",
      html: renderedHTML,
      attachments: req.file && [
        {
          filename: originalname,
          content: buffer,
        },
      ],
    };
    try {
      await sendEmail(mailOptions);
      return res
        .status(200)
        .json({
          status: true,
          message: " Your feedback has been sent successfuly",
        });
    } catch (err) {
      console.log(err);
      return res
        .status(404)
        .send({ status: false, message: "err sending feedback" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "An error occurred" });
  }
}

export default addQuestion;
