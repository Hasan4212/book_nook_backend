import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { toNodeHandler } from 'better-auth/node'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import 'dotenv/config'

// JWT verification
//
// Tokens are issued by the frontend better-auth server (the jwt() plugin
// exposes POST /api/auth/token and publishes its public keys at GET
// /api/auth/jwks). We verify the "Authorization: Bearer <token>" header
// against those public keys, so a token can only be accepted if it was
// really signed by the auth server and has not expired.
const AUTH_ISSUER = process.env.AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL
const authJwks = createRemoteJWKSet(new URL(`${AUTH_ISSUER}/api/auth/jwks`))

const verifyApi = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      return res
      .status(401)
      .send({ message: 'Unauthorized! Authorization: Bearer <token> header is required.' })
    }

    const token = authorization.slice(7).trim()

    const { payload } = await jwtVerify(token, authJwks, {
      issuer: AUTH_ISSUER,
      audience: AUTH_ISSUER,
    })

    // Verified user info from the token payload (the better-auth session user)
    req.user = payload
    next()
  } catch (error) {
    console.error('JWT verification failed:', error?.code ?? error)
    return res
      .status(401)
      .send({ message: 'Unauthorized! Invalid, expired or missing token.' })
  }
}

const app = express()
const port = 8000

// middleware
app.use(
  cors({
    origin: [process.env.AUTH_SERVER_URL],
    credentials: true,
  })
)

app.use(express.json())

// mongodb

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

 const connectedclient = await connectToMongoDB() 
const db = connectedclient.db(`book_nook_backend`) ;
const books = db.collection(`books`);
const borrows = db.collection(`borrows`);

// auth (better-auth with the MongoDB instance)
const auth = betterAuth({
  database: mongodbAdapter(db),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [process.env.AUTH_SERVER_URL],
})

app.all('/api/auth/*splat', toNodeHandler(auth))


const serialize = (doc) => ({ ...doc, _id: String(doc._id) });

const parseId = (id) => {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
};


// http://localhost:8000



app.get('/books', async (req, res) => {
  try {
    const limit = Number(req.query.limit);

    const cursor = books.find({});

    if (limit > 0) {
      cursor.limit(limit);
    }

    const allBooks = await cursor.toArray();

    res.status(200).send(allBooks.map(serialize));
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});

app.get('/books/:id', async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({ message: 'Book not found' });
    }

    const book = await books.findOne({ _id: bookId });

    if (!book) {
      return res.status(404).send({ message: 'Book not found' });
    }

    res.status(200).send(serialize(book));
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch the book' });
  }
})

app.post('/books', verifyApi, async (req, res) => {
  try {
    const result = await books.insertOne(req.body);
    const created = await books.findOne({ _id: result.insertedId });

    res.status(201).send(serialize(created));
  } catch (error) {
    res.status(500).send({ message: 'Failed to add the book' });
  }
})

app.put('/books/:id', verifyApi, async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({ message: 'Book not found' });
    }

    const updated = await books.findOneAndUpdate(
      { _id: bookId },
      { $set: req.body },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).send({ message: 'Book not found' });
    }

    res.status(200).send(serialize(updated));
  } catch (error) {
    res.status(500).send({ message: 'Failed to update the book' });
  }
})

app.delete('/books/:id', verifyApi, async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({ message: 'Book not found' });
    }

    const result = await books.deleteOne({ _id: bookId });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'Book not found' });
    }

    res.status(200).send({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Failed to delete the book' });
  }
})


// borrows

app.post('/borrow', verifyApi, async (req, res) => {
  try {
    const record = {
      ...req.body,
      borrowDate: new Date().toISOString(),
    };

    const result = await borrows.insertOne(record);
    const created = await borrows.findOne({ _id: result.insertedId });

    res.status(201).send(serialize(created));
  } catch (error) {
    res.status(500).send({ message: 'Failed to borrow this book' });
  }
})

app.get('/borrows', verifyApi, async (req, res) => {
  try {
    const query = {};

    // Optional filter, e.g. /borrows?email=...
    if (req.query.email) {
      query.email = req.query.email;
    }

    const allBorrows = await borrows.find(query).toArray();

    res.status(200).send(allBorrows.map(serialize));
  } catch (error) {
    res.status(500).send({
      message: 'Failed to fetch borrowed books',
    });
  }
})

app.delete('/borrow/:id', verifyApi, async (req, res) => {
  try {
    const borrowId = parseId(req.params.id);

    if (!borrowId) {
      return res.status(404).send({ message: 'Borrow record not found' });
    }

    const result = await borrows.deleteOne({ _id: borrowId });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'Borrow record not found' });
    }

    res.status(200).send({ message: 'Borrow record removed successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Failed to remove the borrowed book' });
  }
})

app.listen(port, () => {
  console.log(`server is running at ${port}`)
})


