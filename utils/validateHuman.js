import axios from "axios";
export const validateHuman = async (token) => {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  const { data } = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`
  );
  return data.success;
};
