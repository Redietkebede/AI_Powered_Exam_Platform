import dotenv from "dotenv";
import app from "./app";

dotenv.config();

const PORT = Number(process.env.PORT || 2800);
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
