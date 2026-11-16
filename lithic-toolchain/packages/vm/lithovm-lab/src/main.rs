use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 1 {
        eprintln!("usage: lithovm-lab <source.lithic> (local experiment only)");
        return ExitCode::from(2);
    }
    let result = fs::read_to_string(&args[0])
        .map_err(|e| e.to_string())
        .and_then(|s| lithovm_lab::compile(&s).map_err(str::to_string))
        .and_then(|b| lithovm_lab::execute(&b, 1).map_err(str::to_string));
    match result {
        Ok(value) => {
            println!("LAB ONLY: return={value}; gas_used=1; production_compatible=false");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}
