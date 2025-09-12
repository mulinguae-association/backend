import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Teacher schema
const teacherSchema = new Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: false },
  image: {
    type: String,
    default: "https://res.cloudinary.com/dfnwjr7vo/image/upload/f_auto/v1707236294/fallBackUser_1_q5sgrq.png",
    required: false
  },
  jobBrief: { type: String, required: true },
  telephone: { type: String, required: true },
  aboutTeacher: { type: String, required: true },
  teaching_philosophy: { type: String, required: false },
  career_summary: { type: String, required: false },
  teaching_methods: { type: String, required: false },
  qualification_cert: { type: String, required: false },
  teacher_collaboration: { type: String, required: false },
  classroom_management: { type: String, required: false },
  behavior_management: { type: String, required: false },
  additional_info: { type: String, required: false },
});

const TeacherCard = model('TeacherCard', teacherSchema);

export default TeacherCard;
