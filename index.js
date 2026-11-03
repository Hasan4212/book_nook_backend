
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { toNodeHandler } from "better-auth/node";
import { jwt } from "better-auth/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";
import "dotenv/config";

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL?.replace(/\/+$/, "");
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!AUTH_SERVER_URL) {
  throw new Error("AUTH_SERVER_URL is missing!");
}

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing!");
}

// ==========================================
// EXPRESS APP
// ==========================================

const app = express();

app.use(
  cors({
    origin: [
      FRONTEND_URL,
      "http://localhost:3000",
    ].filter(Boolean),
    credentials: true,
  })
);

app.use(express.json());

// Health check (does not require MongoDB)

app.get("/", (req, res) => {
  res.status(200).send("Book Nook Backend is Running!");
});

app.get("/health", (req, res) => {
  res.status(200).send({
    status: "OK",
    message: "Book Nook API is healthy",
  });
});

// ==========================================
// MONGODB CONNECTION
// ==========================================

const client = new MongoClient(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 10000,
});

const db = client.db("book_nook_backend");

const books = db.collection("books");
const borrows = db.collection("borrows");

let connectionPromise;

export async function connectToMongoDB() {
  if (!connectionPromise) {
    connectionPromise = client.connect().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  return connectionPromise;
}

// Connect to MongoDB before database-dependent routes

app.use(async (req, res, next) => {
  try {
    await connectToMongoDB();
    next();
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);

    res.status(503).send({
      message: "Database temporarily unavailable",
    });
  }
});

// ==========================================
// BETTER AUTH + JWT PLUGIN
// ==========================================

const auth = betterAuth({
  baseURL: AUTH_SERVER_URL,

  database: mongodbAdapter(db),

  emailAndPassword: {
    enabled: true,
  },

  trustedOrigins: [
    FRONTEND_URL,
    "http://localhost:3000",
  ].filter(Boolean),

  plugins: [
    jwt({
      jwt: {
        definePayload: ({ user }) => ({
          id: user.id,
          email: user.email,
        }),
      },
    }),
  ],
});

// Better Auth routes 

app.get("/", (req, res) => {
  res.send("Book Nook Backend is Running!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Backend is running",
  });
});

app.all("/api/auth/*splat", toNodeHandler(auth));

// ==========================================
// JWT VERIFICATION
// ==========================================

const authJwks = createRemoteJWKSet(
  new URL(`${AUTH_SERVER_URL}/api/auth/jwks`)
);

const verifyApi = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).send({
        message: "Authorization Bearer token is required",
      });
    }

    const token = authorization.slice(7).trim();

    const { payload } = await jwtVerify(token, authJwks, {
      issuer: AUTH_SERVER_URL,
      audience: AUTH_SERVER_URL,
    });

    if (!payload.email || !payload.id) {
      return res.status(401).send({
        message: "Invalid user token",
      });
    }

    req.user = payload;

    next();
  } catch (error) {
    console.error("JWT verification failed:", error.message);

    return res.status(401).send({
      message: "Invalid or expired token",
    });
  }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

const serialize = (doc) => ({
  ...doc,
  _id: String(doc._id),
});

const parseId = (id) => {
  try {
    if (!ObjectId.isValid(id)) return null;
    return new ObjectId(id);
  } catch {
    return null;
  }
};

// ==========================================
// BOOKS API
// ==========================================

// GET ALL BOOKS

app.get("/books", async (req, res) => {
  try {
    const limit = Number(req.query.limit);

    const cursor = books.find({});

    if (limit > 0) {
      cursor.limit(Math.min(limit, 100));
    }

    const allBooks = await cursor.toArray();

    res.status(200).send(allBooks.map(serialize));
  } catch (error) {
    console.error("Fetch books error:", error);

    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});

// GET SINGLE BOOK

app.get("/books/:id", async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    const book = await books.findOne({
      _id: bookId,
    });

    if (!book) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.status(200).send(serialize(book));
  } catch (error) {
    console.error("Get book error:", error);

    res.status(500).send({
      message: "Failed to fetch the book",
    });
  }
});

// ADD BOOK

app.post("/books", verifyApi, async (req, res) => {
  try {
    const result = await books.insertOne(req.body);

    const created = await books.findOne({
      _id: result.insertedId,
    });

    res.status(201).send(serialize(created));
  } catch (error) {
    console.error("Add book error:", error);

    res.status(500).send({
      message: "Failed to add the book",
    });
  }
});

// UPDATE BOOK

app.put("/books/:id", verifyApi, async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    const { _id, ...updateData } = req.body;

    const updated = await books.findOneAndUpdate(
      { _id: bookId },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!updated) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.status(200).send(serialize(updated));
  } catch (error) {
    console.error("Update book error:", error);

    res.status(500).send({
      message: "Failed to update the book",
    });
  }
});

// DELETE BOOK

app.delete("/books/:id", verifyApi, async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    const result = await books.deleteOne({
      _id: bookId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.status(200).send({
      message: "Book deleted successfully",
    });
  } catch (error) {
    console.error("Delete book error:", error);

    res.status(500).send({
      message: "Failed to delete the book",
    });
  }
});

// ==========================================
// BORROW API
// ==========================================

// BORROW A BOOK

app.post("/borrow", verifyApi, async (req, res) => {
  try {
    const record = {
      ...req.body,

      // Always use the verified user's email
      email: req.user.email,

      borrowDate: new Date().toISOString(),
    };

    const result = await borrows.insertOne(record);

    const created = await borrows.findOne({
      _id: result.insertedId,
    });

    res.status(201).send(serialize(created));
  } catch (error) {
    console.error("Borrow error:", error);

    res.status(500).send({
      message: "Failed to borrow this book",
    });
  }
});

// GET LOGGED-IN USER'S BORROWS

app.get("/borrows", verifyApi, async (req, res) => {
  try {
    const allBorrows = await borrows
      .find({
        email: req.user.email,
      })
      .toArray();

    res.status(200).send(allBorrows.map(serialize));
  } catch (error) {
    console.error("Fetch borrows error:", error);

    res.status(500).send({
      message: "Failed to fetch borrowed books",
    });
  }
});

// DELETE OWN BORROW RECORD

app.delete("/borrow/:id", verifyApi, async (req, res) => {
  try {
    const borrowId = parseId(req.params.id);

    if (!borrowId) {
      return res.status(404).send({
        message: "Borrow record not found",
      });
    }

    const result = await borrows.deleteOne({
      _id: borrowId,
      email: req.user.email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Borrow record not found",
      });
    }

    res.status(200).send({
      message: "Borrow record removed successfully",
    });
  } catch (error) {
    console.error("Delete borrow error:", error);

    res.status(500).send({
      message: "Failed to remove the borrowed book",
    });
  }
});

// ==========================================
// VERCEL + LOCAL SERVER
// ==========================================

// Vercel handles the serverless function.
// app.listen is only for local development.

if (!process.env.VERCEL) {
  const port = process.env.PORT || 8000;

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

export default app;
