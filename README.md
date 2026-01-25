# Mulingua Backend

This is the backend for the Mulingua application, built with Node.js, Express, and MongoDB (Mongoose). It provides RESTful APIs for authentication, blog posts, comments, teacher cards, FAQs, and contact forms.

## Features

- User registration, login, and JWT-based authentication
- Blog post creation, moderation, and search
- Commenting and interaction system
- Teacher card management
- FAQ and contact form endpoints
- Email notifications (e.g., password reset)
- Image upload and conversion (Cloudinary)
- reCAPTCHA validation for human verification

## Technologies Used

- Node.js
- Express.js
- MongoDB & Mongoose
- JWT for authentication
- Cloudinary for image storage
- Nodemailer for emails
- dotenv for environment variables

## Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- MongoDB Atlas account (or local MongoDB)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/abdelrhman-shibl44/mulingua-backend.git
   cd mulingua-backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add the following:
   ```env
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   EMAIL=your_email
   EMAIL_PASS=your_email_password
   RECAPTCHA_SECRET_KEY=your_recaptcha_secret
   CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_api_key
   CLOUDINARY_API_SECRET=your_cloudinary_api_secret
   FRONTEND_URL=http://localhost:3000
   ```

### Running the Server

```bash
npm start
```

The server will run on `http://localhost:5000` by default.

## Deployment

- The backend is ready for deployment on Vercel. See `vercel.json` for configuration.
- Set all environment variables in your Vercel project settings.

## API Endpoints

- `/api/auth` - Authentication routes (register, login, logout, profile, etc.)
- `/api/blogPosts` - Blog post management
- `/api/comments` - Comments and interactions
- `/api/teacherCards` - Teacher card management
- `/api/contact` - Contact form
- `/api/faqs` - FAQs

## Notes

- Ensure your MongoDB Atlas cluster allows connections from your deployment environment.
- For production, use secure values for all secrets and credentials.

## License

MIT
