const Book = require("../models/book");
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');
const rimraf = require('rimraf');
exports.createBook = (req, res, next) => {
    try {
        // Vérification des données reçues
        const bookObject = JSON.parse(req.body.book);
        delete bookObject._id;
        delete bookObject.userId;

        // Création de l'objet Book
        const book = new Book({
            ...bookObject,
            userId: req.auth.userId,
            imageUrl: `${req.protocol}://${req.get('host')}/images/${req.file.filename}`, // URL originale
        });

        // Chemins pour Sharp
        const inputPath = path.join(__dirname, '../images', req.file.filename); // Fichier téléchargé
        const outputFilename = `optimized-${req.file.filename}.webp`; // Nom de l'image optimisée
        const outputPath = path.join(__dirname, '../images', outputFilename); // Chemin absolu vers l'image optimisée

        // Vérification que le fichier d'entrée existe
        if (!req.file || !req.file.filename) {
            throw new Error('Fichier manquant dans la requête.');
        }

        // Traitement de l'image avec Sharp
        sharp(inputPath)
            .resize(500) // Redimensionner l'image
            .webp({ quality: 80 }) // Compression avec WebP
            .toFile(outputPath) // Enregistrer l'image optimisée
            .then(() => {
                console.log('Image optimisée avec succès !');
                setTimeout(() => {
                    fs.unlink(inputPath, (err) => {
                        if (err) {
                            console.error('Erreur lors de la suppression du fichier original :', err);
                        } else {
                            console.log('Fichier original supprimé avec succès.');
                        }
                    });
                }, 100); // Attendez 100ms avant de supprimer le fichier

                // Mettre à jour l'URL de l'image optimisée
                book.imageUrl = `${req.protocol}://${req.get('host')}/images/${outputFilename}`;
                // Enregistrer le livre en base de données
                return book.save();

            })
            .then(() => {

                res.status(201).json({ message: 'Livre enregistré avec succès !' });
            })
            .catch((err) => {
                console.error('Erreur lors du traitement de l’image :', err);
                res.status(500).json({ error: 'Erreur lors du traitement de l’image.' });
            });
    } catch (error) {
        console.error('Erreur générale :', error);
        res.status(400).json({ error: error.message || 'Requête invalide.' });
    }
};

exports.getOneBook = (req, res, next) => {
    Book.findOne({
        _id: req.params.id
    }).then(
        (thing) => {
            res.status(200).json(thing);
        }
    ).catch(
        (error) => {
            res.status(404).json({
                error: error
            });
        }
    );
};

exports.modifyBook = (req, res, next) => {
    const bookObject = req.file ? {
        ...JSON.parse(req.body.book),
        imageUrl: `${req.protocol}://${req.get('host')}/images/${req.file.filename}`
    } : { ...req.body };

    delete bookObject.userId;
    Book.findOne({_id: req.params.id})
        .then((book) => {
            if (book.userId !== req.auth.userId) {
                res.status(401).json({ message : 'Not authorized'});
            } else {
                Book.updateOne({ _id: req.params.id}, { ...bookObject, _id: req.params.id})
                    .then(() => res.status(200).json({message : 'Objet modifié!'}))
                    .catch(error => res.status(401).json({ error }));
            }
        })
        .catch((error) => {
            res.status(400).json({ error });
        });
};

exports.deleteBook = (req, res, next) => {
    Book.findOne({ _id: req.params.id})
        .then(book => {
            if (book.userId !== req.auth.userId) {
                res.status(401).json({message: 'Not authorized'});
            } else {
                const filename = book.imageUrl.split('/images/')[1];
                fs.unlink(`images/${filename}`, () => {
                    Book.deleteOne({_id: req.params.id})
                        .then(() => { res.status(200).json({message: 'Objet supprimé !'})})
                        .catch(error => res.status(401).json({ error }));
                });
            }
        })
        .catch( error => {
            res.status(500).json({ error });
        });
};

exports.getAllBook = (req, res, next) => {
    Book.find().then(
        (things) => {
            res.status(200).json(things);
        }
    ).catch(
        (error) => {
            res.status(400).json({
                error: error
            });
        }
    );
};
exports.rateBook = async (req, res, next) => {
    const { userId, rating } = req.body;
    const grade = rating; // Mapper `rating` vers `grade`

    console.log(req.body);

    // Vérification de la présence de l'identifiant
    if (!req.params.id) {
        return res.status(400).json({ message: "L'identifiant du livre est requis." });
    }

    // Vérification que 'grade' est fourni dans la requête
    if (typeof grade !== 'number' || grade < 1 || grade > 5) {
        return res.status(400).json({ message: 'La note doit être un nombre entre 1 et 5.' });
    }

    try {
        // Trouver le livre par son ID
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ message: 'Livre non trouvé.' });
        }

        // Vérifier si l'utilisateur a déjà noté ce livre
        const existingRating = book.ratings.find((rating) => rating.userId === userId);
        if (existingRating) {
            return res.status(400).json({ message: 'Vous avez déjà noté ce livre.' });
        }

        // Ajouter la nouvelle note avec le champ 'grade'
        book.ratings.push({ userId, grade });

        // Calculer la nouvelle moyenne
        const totalGrades = book.ratings.reduce((sum, rating) => sum + rating.grade, 0);
        book.averageRating = Math.round((totalGrades / book.ratings.length) * 10) / 10;


        // Sauvegarder les modifications
        try {
            const updatedBook = await book.save();
            res.status(200).json(updatedBook);
        } catch (saveError) {
            console.error('Erreur lors de la sauvegarde du livre :', saveError);
            res.status(400).json({ message: 'Impossible de sauvegarder les modifications.', error: saveError });
        }
    } catch (error) {
        res.status(500).json({ error });
    }
};

exports.getTopRatedBooks = (req, res, next) => {
    Book.find()
        .sort({ averageRating: -1 })
        .limit(3)
        .then((books) => {
            res.status(200).json(books);
        })
        .catch(error => {
            res.status(400).json({ error });
        });
};




