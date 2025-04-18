import nodemailer from "nodemailer";
import { __dirname } from '../utils/dirname.js';
import { promises as fs } from 'fs';
import path from 'path';

async function submitForm(req, res) {
  try {
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS
      },
    });

    const formData = req.body;
    const cv = req.file;
    const { userType } = req.params;

    let subject = userType === 'teacher' ? 'Teacher FORM Submission' : 'Student Form Submission';

    // Read the HTML template from the file
    const templatePath = path.join(__dirname, "../email_templates/contact_form.html");
    const htmlTemplate = await fs.readFile(templatePath, 'utf-8')

    // Replace placeholders in the HTML template with actual form data

    let additionalInfo = ""
    if (userType === "teacher") {
      additionalInfo += `
      <p><strong>subjectsTaught:&nbsp;</strong> ${formData.subjectsTaught}</p>
      <p><strong>address:&nbsp;</strong> ${formData.address}</p>
    `;
    } else {
      additionalInfo += `
      <p><strong>age:&nbsp;</strong> ${formData.age}</p>
    `;
    }

    // Add message field if it exists
    if (formData.message) {
      additionalInfo += `
      <p><strong>message:&nbsp;</strong> ${formData.message}</p>
    `;
    }

    let formattedData = htmlTemplate
      .replace('${userType}', userType)
      .replace('${fullName}', formData.fullName)
      .replace('${email}', formData.email)
      .replace('${phoneNumber}', formData.phoneNumber)
      .replace('${country}', formData.country)
      .replace('${languagesSpoken}', formData.languagesSpoken)
      .replace('${additionalInfo}', additionalInfo);

    const mailOptions = {
      from: formData.email,
      to: "ascmulingua@gmail.com",
      subject: subject,
      html: formattedData,
    };

    // Check if there are files to attach
    if (cv) {
      mailOptions.attachments = [
        {
          filename: cv.originalname,
          content: cv.buffer,
          contentType: cv.mimetype,
        },
      ];
    }

    transporter.sendMail(mailOptions, (err) => {
      if (err) {
        res.status(500).json({ success: false, message: "Error sending email" });
      } else {
        res.status(200).json({ success: true, message: 'Email sent successfully' });
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export { submitForm };
