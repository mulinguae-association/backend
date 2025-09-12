import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: "465",
  secure: true,
  service: "Gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async (mailOptions) => {
  try {
    await transport.sendMail(mailOptions);
  } catch (error) {
    console.log(error);
  }
};

export { sendEmail };
