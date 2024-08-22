local M = {
  gh_device_code = nil,
}

local config = require('config')

-- Gets the path of the plugin directory. Usually `~/.local/share/nvim/lazy/ai-chat.nvim/`
function M.get_plugin_path()
  local path = debug.getinfo(1, "S").source:sub(2)
  return path:match("(.*/)")
end

-- Gets the path of the copilot typescript script.
local function get_copilot_script_path()
  local dir_path = M.get_plugin_path()
  -- if there is no executable or bun_executable in the config, we will use the shipped bun executable
  local bun_path = string.format("%s ", vim.fn.exepath("bun") or config.default.bun_executable or "")
  return string.format("%s%smonica/index.ts ", bun_path, dir_path)
end

-- Runs the copilot script with the given arguments.
function M.run_copilot_script(args)
  local path = get_copilot_script_path()

  if M.gh_device_code ~= nil then
    local handle = io.popen(path .. "connect " .. M.gh_device_code)
    local result = handle:read("*a")
    handle:close()
    M.gh_device_code = nil
  end

  local command = path .. args

  if config.default.core_instructions ~= nil then
    local core_file = config.default.files.cores_dir .. config.default.core_instructions .. ".md"
    command = command .. " --core_instruction_file=" .. core_file
  end

  local handle = io.popen(command)
  local result = handle:read("*a")
  handle:close()

  -- if the result starts with the line @@@, it means we have to connect to GH
  if string.sub(result, 1, 3) == "@@@" then
    local lines = vim.split(result, "\n")
    local verification_uri = lines[2]
    local user_code = lines[3]
    local device_code = lines[4]

    M.gh_device_code = device_code

    print("You need to connect to GitHub")
    result = "Please visit " ..
        verification_uri .. " and enter " .. user_code .. "\n\nOnce this is done, ask me something!\n"
  end

  return result
end

-- copies a file from source to destination
function M.copy_file(source, destination)
  local handle = io.open(source, "r")
  local content = handle:read("*a")
  handle:close()

  handle = io.open(destination, "w+")
  handle:write(content)
  handle:close()
end

return M;
