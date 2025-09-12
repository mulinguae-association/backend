import dotenv from 'dotenv'; // Move dotenv import to the top
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import routes from './routes/index.js';
import { connectToDatabase } from './db/db.js';
import createAdminUser from './utils/createAdminUser.js';
import cookieParser from 'cookie-parser';
import compression from 'compression';
dotenv.config(); // Load environment variables from .env

const app = express();
const PORT = process.env.PORT || 5000;
app.use(bodyParser.json());
app.use(cors({
  credentials: true,
  origin: 'http://localhost:3000'
}));

app.use(express.json());
app.use(compression());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }))
//middleware 

// Connect to MongoDB
connectToDatabase()
  .then(() => {
    console.log('Connected to MongoDB');
    createAdminUser()
      .then(() => console.log("Predefined user created successfully"))
      .catch((error) => {
        console.error("Error creating predefined user:", error);
      });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });


// Mount the routes
app.use('/uploads', express.static('uploads'));
app.use('/api', routes);

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));