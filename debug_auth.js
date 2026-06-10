import bcrypt from 'bcryptjs';

const ADMIN_EMAIL = "highlife4real1989@gmail.com";
const ADMIN_PASSWORD_HASH = "$2b$12$NZp4M9iW5r24srmjPRm2G.DKJn77ovD5FruNMMxjgYQfhtInkknlO";

async function verify(email, password) {
  const identifier = email.toLowerCase();
  const adminEmail = ADMIN_EMAIL.toLowerCase();
  const adminUsername = ADMIN_EMAIL.split("@")[0].toLowerCase();
  
  console.log(`Checking: ${identifier} against ${adminEmail} or ${adminUsername}`);
  
  if (identifier !== adminEmail && identifier !== adminUsername) {
    console.log("Email mismatch");
    return false;
  }
  
  const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  console.log(`Password valid: ${valid}`);
  return valid;
}

verify("highlife4real1989@gmail.com", "Around360!!").then(result => console.log("Result:", result));
