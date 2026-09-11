import Teacher from "../db/models/TeacherCard.js";
import { convertToWebp } from "../utils/imageConversion.js";
import { __dirname } from "../utils/dirname.js";
import { cloudinary, handleUpload } from "../utils/cloundinaryConfig.js";
import { isAdminRole } from "../utils/isAdminRole.js";
export const createTeacherCard = async (req, res) => {
  try {
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ error: "No permission." });
    }
    const {
      firstName,
      lastName,
      email,
      jobBrief,
      telephone,
      aboutTeacher,
      teaching_philosophy,
      career_summary,
      teaching_methods,
      qualification_cert,
      teacher_collaboration,
      classroom_management,
      behavior_management,
      additional_info,
    } = req.body;
    let image =
      "https://res.cloudinary.com/dfnwjr7vo/image/upload/f_auto/v1707236294/fallBackUser_1_q5sgrq.png";
    if (req.file) {
      const croppedImage = await convertToWebp(req.file.buffer, undefined);
      const b64 = croppedImage.toString("base64");
      let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const cldRes = await handleUpload(dataURI, "teacherImg");
      image = cldRes.secure_url;
    }
    const newTeacher = new Teacher({
      firstName,
      lastName,
      email,
      image,
      jobBrief,
      telephone,
      aboutTeacher,
      teaching_philosophy,
      career_summary,
      teaching_methods,
      qualification_cert,
      teacher_collaboration,
      classroom_management,
      behavior_management,
      additional_info,
    });
    await newTeacher.save();

    res.status(200).json({ newTeacher });
  } catch (error) {
    console.error("Error creating teacher:", error);
    res.status(500).json({ error: "Error creating teacher." });
  }
};

export const updateTeacherCard = async (req, res) => {
  try {
    const teacherId = req.params.id;
    const { firstName, lastName, email, jobBrief, telephone, aboutTeacher } =
      req.body;
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ error: "No permission." });
    }

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res
        .status(404)
        .json({ error: "Teacher not found", success: false });
    }

    let newImage = "";
    let oldImage = teacher.image;

    if (req.file) {
      // Remove previous profile image from Cloudinary
      if (oldImage) {
        const publicId = oldImage.split("/").pop().split(".")[0];
        console.log(publicId);
        await cloudinary.uploader.destroy(
          `teacherImg/${publicId}`,
          async (error) => {
            if (error) {
              console.error(error);
              return res
                .status(500)
                .json({
                  message: "Error deleting previous image from Cloudinary",
                });
            }
          }
        );
      }
      const croppedImage = await convertToWebp(req.file.buffer, undefined);
      const b64 = croppedImage.toString("base64");
      let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const cldRes = await handleUpload(dataURI, "teacherImg");
      newImage = cldRes.secure_url;
    }

    teacher.firstName = firstName;
    teacher.lastName = lastName;
    teacher.email = email;
    teacher.jobBrief = jobBrief;
    teacher.aboutTeacher = aboutTeacher;
    teacher.telephone = telephone;
    teacher.image = newImage || oldImage;

    await teacher.save();

    res
      .status(200)
      .json({
        message: "Teacher updated successfully",
        updatedTeacher: teacher,
        success: true,
      });
  } catch (error) {
    console.error("Error updating teacher:", error);
    res.status(500).json({ message: "Internal server error", success: false });
  }
};

export const getTeachersCard = async (req, res) => {
  const { id } = req.params;
  try {
    if (id) {
      const teacher = await Teacher.findById(String(id));
      if (!teacher) {
        return res.status(404).json({ message: "Teacher not found" });
      }
      return res.status(200).json(teacher);
    }
    const teachers = await Teacher.find();
    res.status(200).json(teachers);
  } catch (error) {
    console.error("Error fetching teachers:", error);
    res.status(500).json({ message: "Error fetching teachers." });
  }
};

export const deleteTeacherCard = async (req, res) => {
  try {
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ error: "No permission." });
    }
    const teacherId = req.params.id;

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    if (teacher.image) {
      const publicId = teacher.image.split("/").pop().split(".")[0];
      console.log(publicId);
      await cloudinary.uploader.destroy(
        `teacherImg/${publicId}`,
        async (error) => {
          if (error) {
            console.error(error);
            return res
              .status(500)
              .json({
                message: "Error deleting previous image from Cloudinary",
              });
          }
        }
      );
    }

    await teacher.deleteOne();

    res.status(200).json({ message: "Teacher deleted successfully" });
  } catch (error) {
    console.error("Error deleting teacher:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
